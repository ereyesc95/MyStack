"""Resolve cover/disc/canvas/background and gallery scans from a track play path."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from app.artwork_stems import (
    track_animation_url,
    track_canvas_url,
    track_cover_url,
    track_visualizer_url,
)
from app.band_library import (
    _find_artwork_subdir,
    _find_cover_front_artwork,
    _strip_bracket_suffix,
    _track_title_from_filename,
)
from app.gallery import IMAGE_EXTS, _artist_dir, _media_url
from app.media_index import _is_edition_dir, _is_edition_folder, _is_group_subdir_name
from app.media_paths_util import safe_relative
from app.release_overview import (
    _artwork_urls,
    _find_singles_parent_folder,
    _resolve_standard_edition,
    _single_title_from_folder,
    _singles_category_dir,
    _standard_artwork_dir,
)

ARTWORK_DIR = "[artwork]"
DEFAULT_DISC_MARKER = "default/disc.png"
DISC_LOOSE_RE = re.compile(r"^Disc\s+(\d+)", re.I)
SIDE_RE = re.compile(r"^\d+\.\s*Side\s+", re.I)
SIDE_LOOSE_RE = re.compile(r"^Side\s+[A-Z]\b", re.I)
VINYL_SIDE_STEM_RE = re.compile(r"^([A-Z])(\d+)", re.I)
TAPE_RE = re.compile(r"^\d+\.\s*(Tape|Cassette)\s+", re.I)
TAPE_LOOSE_RE = re.compile(r"^Tape\s+[A-Z]\b", re.I)
CASSETTE_LOOSE_RE = re.compile(r"^Cassette\s+[A-Z]\b", re.I)
EXCLUDED_ARTWORK_STEMS = {
    "logo",
    "spotify",
    "qr",
}


def _gallery_item_id(rel_path: str) -> str:
    digest = hashlib.sha256(rel_path.casefold().encode("utf-8")).hexdigest()[:12]
    return f"gal_{digest}"


def _is_photocard_stem(stem: str) -> bool:
    return stem.casefold().startswith("photocard")


def _is_excluded_artwork(stem: str) -> bool:
    low = stem.casefold()
    if low in EXCLUDED_ARTWORK_STEMS:
        return True
    return _is_photocard_stem(low)


def _scan_artwork_file(path: Path, media_root: Path) -> dict:
    rel = safe_relative(path, media_root) or path.name
    return {
        "id": _gallery_item_id(rel),
        "url": _media_url(path, media_root),
        "title": path.stem,
        "folder_path": rel,
        "section": "artwork",
    }


@dataclass(frozen=True)
class PlaybackArtContext:
    release_content: Path | None = None
    release_title: str | None = None
    band_name: str | None = None


def _normalize_title(title: str) -> str:
    t = re.sub(r"\s*\[.*\]\s*$", "", title.strip())
    t = re.sub(r"\s*\(.*\)\s*$", "", t).strip()
    return t.casefold()


def _edition_folder_for_audio(audio_file: Path) -> Path:
    folder = audio_file.parent
    visited: set[str] = set()
    for _ in range(15):
        key = str(folder)
        if key in visited:
            break
        visited.add(key)
        if _find_artwork_subdir(folder):
            return folder
        if _is_group_subdir_name(folder.name):
            parent = folder.parent
            if parent == folder:
                break
            folder = parent
            continue
        if _is_edition_folder(folder.name) or _is_edition_dir(folder):
            return folder
        parent = folder.parent
        if parent == folder:
            break
        folder = parent
    return audio_file.parent


def _single_root_for_audio(audio_file: Path, media_root: Path) -> Path | None:
    rel = (safe_relative(audio_file, media_root) or "").replace("\\", "/")
    parts = [p for p in rel.split("/") if p]
    singles_idx = next((i for i, p in enumerate(parts) if p.casefold() == "singles"), -1)
    if singles_idx < 0 or singles_idx + 2 >= len(parts):
        return None
    single_rel = "/".join(parts[: singles_idx + 3])
    single_root = media_root / Path(single_rel)
    return single_root if single_root.is_dir() else None


def _disc_number_from_label(name: str) -> int | None:
    m = re.search(r"disc\s*(\d+)", name, re.I)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def _is_disc_group_name(name: str) -> bool:
    from app.media_index import DISC_DIR_RE

    return bool(DISC_DIR_RE.match(name) or DISC_LOOSE_RE.match(name))


def _is_playback_group_name(name: str) -> bool:
    return bool(
        _is_disc_group_name(name)
        or SIDE_RE.match(name)
        or SIDE_LOOSE_RE.match(name)
        or TAPE_RE.match(name)
        or TAPE_LOOSE_RE.match(name)
        or CASSETTE_LOOSE_RE.match(name)
    )


def _normalize_group_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def _disc_stem_matches_group(stem: str, group_label: str) -> bool:
    group_num = _disc_number_from_label(group_label)
    stem_num = _disc_number_from_label(stem)
    if group_num is not None:
        if stem_num is not None:
            return group_num == stem_num
        stem_cf = stem.casefold().strip()
        if stem_cf in {"disc", "cd", "vinyl"}:
            return group_num == 1
        return False
    if stem_num is not None:
        return False
    gn = _normalize_group_token(group_label)
    sn = _normalize_group_token(stem)
    if not gn or not sn:
        return False
    return gn == sn or sn in gn or gn in sn


def _is_group_artwork_stem(stem: str) -> bool:
    low = stem.casefold().strip()
    if low.startswith("cover"):
        return False
    if low in EXCLUDED_ARTWORK_STEMS:
        return False
    if _is_photocard_stem(low):
        return False
    if "logo" in low:
        return False
    return True


def disc_url_for_group(
    edition_artwork: Path | None,
    group_dir: Path | None,
    media_root: Path,
    group_label: str | None,
) -> str | None:
    search_dirs: list[Path] = []
    if group_dir:
        art = _find_artwork_subdir(group_dir)
        if art:
            search_dirs.append(art)
    if edition_artwork:
        search_dirs.append(edition_artwork)

    candidates: list[Path] = []
    for art in search_dirs:
        if not art.is_dir():
            continue
        for p in art.iterdir():
            if not p.is_file() or p.suffix.lower() not in IMAGE_EXTS:
                continue
            stem = p.stem
            if not _is_group_artwork_stem(stem):
                continue
            stem_cf = stem.casefold()
            if group_label:
                if _disc_stem_matches_group(stem, group_label):
                    candidates.append(p)
                continue
            if (
                "disc" in stem_cf
                or "vinyl" in stem_cf
                or "cd" in stem_cf
                or "side" in stem_cf
                or "tape" in stem_cf
                or "cassette" in stem_cf
            ):
                candidates.append(p)
    if not candidates:
        return None

    if group_label:
        for p in candidates:
            if _disc_stem_matches_group(p.stem, group_label):
                return _media_url(p, media_root)
        return None

    candidates.sort(
        key=lambda p: (0 if p.stem.casefold().startswith("disc 1") else 1, p.name.casefold())
    )
    return _media_url(candidates[0], media_root)


def resolve_disc_url_for_group(
    edition_artwork: Path | None,
    group_dir: Path | None,
    media_root: Path,
    group_label: str | None,
    *,
    release_content: Path | None = None,
) -> str | None:
    if group_label:
        disc_url = disc_url_for_group(edition_artwork, group_dir, media_root, group_label)
        if disc_url:
            return disc_url
        if release_content:
            return _release_standard_disc_url(release_content, media_root)
        return None
    disc_url = disc_url_for_group(edition_artwork, group_dir, media_root, None)
    return _apply_disc_fallback(
        disc_url,
        release_content=release_content,
        media_root=media_root,
    )


def _disc_group_for_audio(audio_file: Path) -> tuple[Path | None, str | None]:
    parent = audio_file.parent
    if _is_playback_group_name(parent.name):
        return parent, parent.name
    stem = Path(audio_file.name).stem.strip()
    stem = re.sub(r"^\d+\.\s*", "", stem).strip()
    vinyl = VINYL_SIDE_STEM_RE.match(stem)
    if vinyl:
        return parent, f"Side {vinyl.group(1).upper()}"
    return None, None


def _release_standard_disc_url(release_content: Path, media_root: Path) -> str | None:
    edition = _resolve_standard_edition(release_content)
    artwork = _standard_artwork_dir(edition)
    urls = _artwork_urls(artwork, media_root)
    disc = urls.get("disc_url")
    if disc and DEFAULT_DISC_MARKER not in disc:
        return disc
    return None


def _single_edition_for_album_track(
    audio_file: Path,
    media_root: Path,
    *,
    release_content: Path,
    release_title: str,
    band_name: str,
) -> Path | None:
    if _single_root_for_audio(audio_file, media_root):
        return None

    track_norm = _normalize_title(_track_title_from_filename(audio_file))
    if not track_norm:
        return None

    artist_dir = _artist_dir(media_root, band_name)
    if not artist_dir:
        return None
    singles_cat = _singles_category_dir(artist_dir)
    if not singles_cat:
        return None
    parent = _find_singles_parent_folder(
        singles_cat, release_title=release_title, content=release_content
    )

    if parent:
        for child in sorted(parent.iterdir(), key=lambda p: p.name.casefold()):
            matched = _match_single_folder(child, track_norm)
            if matched:
                return matched

    return _find_single_edition_by_title_scan(
        media_root, band_name, _track_title_from_filename(audio_file)
    )


def _match_single_folder(folder: Path, track_norm: str) -> Path | None:
    if not folder.is_dir() or folder.name.casefold() == ARTWORK_DIR:
        return None
    single_title = _single_title_from_folder(folder, folder.name)
    single_norm = _normalize_title(single_title)
    if not single_norm:
        return None
    if (
        track_norm == single_norm
        or track_norm.startswith(f"{single_norm} ")
        or single_norm in track_norm
    ):
        return _resolve_standard_edition(folder)
    return None


def _track_cover_stem(track_title: str) -> str:
    clean = _strip_bracket_suffix(track_title.strip())
    clean = re.sub(r"\s*\(.*\)\s*$", "", clean).strip()
    return f"Cover - {clean}"


def find_track_cover_in_artwork(
    artwork: Path | None,
    track_title: str,
    media_root: Path,
) -> str | None:
    return track_cover_url(artwork, track_title, media_root)


def apply_track_artwork_overrides(
    urls: dict[str, str | None],
    album_artwork: Path | None,
    track_title: str,
    media_root: Path,
) -> dict[str, str | None]:
    """Prefer track-specific Cover / Animation / Canvas / Visualizer.

    ``Cover - {title}`` (still) takes priority over album ``Cover - Animation`` /
    ``Cover - Canvas`` — same as a linked single's ``Cover - Front``.
    Track ``Animation - {title}`` / ``Canvas - {title}`` / ``Visualizer - {title}``
    override when present.
    """
    if not album_artwork or not album_artwork.is_dir():
        return urls
    out = dict(urls)
    track_cover = track_cover_url(album_artwork, track_title, media_root)
    track_animation = track_animation_url(album_artwork, track_title, media_root)
    track_canvas = track_canvas_url(album_artwork, track_title, media_root)
    track_visualizer = track_visualizer_url(album_artwork, track_title, media_root)

    if track_cover:
        out["cover_front_url"] = track_cover
    if track_animation:
        out["cover_animation_url"] = track_animation
    elif track_cover:
        # Still track cover wins over album Cover - Animation
        out["cover_animation_url"] = None
    if track_canvas:
        out["canvas_url"] = track_canvas
    elif track_cover:
        out["canvas_url"] = None
    if track_visualizer:
        out["visualizer_url"] = track_visualizer
    return out


def _find_single_edition_by_title_scan(
    media_root: Path,
    band_name: str,
    track_title: str,
) -> Path | None:
    track_norm = _normalize_title(track_title)
    if not track_norm:
        return None
    artist_dir = _artist_dir(media_root, band_name)
    if not artist_dir:
        return None
    singles_cat = _singles_category_dir(artist_dir)
    if not singles_cat:
        return None
    for parent in sorted(singles_cat.iterdir(), key=lambda p: p.name.casefold()):
        if not parent.is_dir():
            continue
        matched = _match_single_folder(parent, track_norm)
        if matched:
            return matched
        for child in sorted(parent.iterdir(), key=lambda p: p.name.casefold()):
            matched = _match_single_folder(child, track_norm)
            if matched:
                return matched
    return None


def _edition_under_single_root(audio_file: Path, single_root: Path) -> Path:
    """Prefer the track's edition folder (e.g. Deluxe) over the single's Standard art."""
    edition = _edition_folder_for_audio(audio_file)
    try:
        edition.resolve().relative_to(single_root.resolve())
        return edition
    except (ValueError, OSError):
        return _resolve_standard_edition(single_root)


def _single_artwork_edition_for_audio(
    audio_file: Path,
    media_root: Path,
    *,
    band_name: str | None = None,
    track_title: str | None = None,
    release_content: Path | None = None,
    release_title: str | None = None,
) -> Path | None:
    single_root = _single_root_for_audio(audio_file, media_root)
    if single_root:
        return _edition_under_single_root(audio_file, single_root)
    title = track_title or _track_title_from_filename(audio_file)
    if (
        band_name
        and release_content
        and release_title
    ):
        single_edition = _single_edition_for_album_track(
            audio_file,
            media_root,
            release_content=release_content,
            release_title=release_title,
            band_name=band_name,
        )
        if single_edition:
            return single_edition
    if band_name:
        return _find_single_edition_by_title_scan(media_root, band_name, title)
    return None


def _collect_artwork_dirs_for_audio(audio_file: Path) -> list[Path]:
    dirs: list[Path] = []
    seen: set[str] = set()
    folder = audio_file.parent
    for _ in range(12):
        art = _find_artwork_subdir(folder)
        if art:
            key = str(art.resolve())
            if key not in seen:
                seen.add(key)
                dirs.append(art)
        if folder.parent == folder:
            break
        folder = folder.parent
    return dirs


def resolve_display_cover_for_audio(
    audio_file: Path,
    media_root: Path,
    *,
    band_name: str | None = None,
    track_title: str | None = None,
) -> str | None:
    """Thumbnail cover: single release → Cover - title → Cover - Front."""
    from app.artwork_stems import resolve_cover_front_file

    title = track_title or _track_title_from_filename(audio_file)
    single_edition = _single_artwork_edition_for_audio(
        audio_file,
        media_root,
        band_name=band_name,
        track_title=title,
    )
    if single_edition:
        artwork = _standard_artwork_dir(single_edition)
        if artwork:
            cover_file = resolve_cover_front_file(artwork)
            if cover_file:
                return _media_url(cover_file, media_root)

    for art_dir in _collect_artwork_dirs_for_audio(audio_file):
        track_cover = track_cover_url(art_dir, title, media_root)
        if track_cover:
            return track_cover

    return _find_cover_front_artwork(audio_file.parent, media_root)


def _artwork_root_for_audio(
    audio_file: Path,
    media_root: Path,
    ctx: PlaybackArtContext | None = None,
) -> Path:
    single_root = _single_root_for_audio(audio_file, media_root)
    if single_root:
        return _edition_under_single_root(audio_file, single_root)

    if (
        ctx
        and ctx.release_content
        and ctx.release_title
        and ctx.band_name
    ):
        single_edition = _single_edition_for_album_track(
            audio_file,
            media_root,
            release_content=ctx.release_content,
            release_title=ctx.release_title,
            band_name=ctx.band_name,
        )
        if single_edition:
            return single_edition

    if ctx and ctx.band_name:
        scanned = _find_single_edition_by_title_scan(
            media_root,
            ctx.band_name,
            _track_title_from_filename(audio_file),
        )
        if scanned:
            return scanned

    return _edition_folder_for_audio(audio_file)


def _apply_disc_fallback(
    disc_url: str | None,
    *,
    release_content: Path | None,
    media_root: Path,
) -> str | None:
    if disc_url and DEFAULT_DISC_MARKER not in disc_url:
        return disc_url
    if release_content:
        return _release_standard_disc_url(release_content, media_root) or disc_url
    return disc_url


def _playback_group_kind(group_label: str | None) -> str:
    if not group_label:
        return "disc"
    if SIDE_RE.match(group_label) or SIDE_LOOSE_RE.match(group_label):
        return "side"
    if (
        TAPE_RE.match(group_label)
        or TAPE_LOOSE_RE.match(group_label)
        or CASSETTE_LOOSE_RE.match(group_label)
    ):
        return "tape"
    return "disc"


def playback_art_for_audio_file(
    audio_file: Path,
    media_root: Path,
    *,
    ctx: PlaybackArtContext | None = None,
) -> dict[str, list[str] | str | None]:
    title = _track_title_from_filename(audio_file)
    single_edition = _single_artwork_edition_for_audio(
        audio_file,
        media_root,
        band_name=ctx.band_name if ctx else None,
        track_title=title,
        release_content=ctx.release_content if ctx else None,
        release_title=ctx.release_title if ctx else None,
    )
    edition_folder = _artwork_root_for_audio(audio_file, media_root, ctx)
    artwork = _standard_artwork_dir(edition_folder)
    urls = _artwork_urls(artwork, media_root)

    # Edition [Artwork] first; fill missing visualizer/canvas/landscape from
    # the release's standard edition (locked visualizer ladder fallback).
    if ctx and ctx.release_content:
        standard_artwork = _standard_artwork_dir(
            _resolve_standard_edition(ctx.release_content)
        )
        if (
            standard_artwork
            and artwork
            and standard_artwork.resolve() != artwork.resolve()
        ):
            std_urls = _artwork_urls(standard_artwork, media_root)
            for key in (
                "visualizer_url",
                "canvas_url",
                "cover_landscape_url",
                "cover_portrait_url",
                "cover_banner_url",
                "cover_animation_url",
                "cover_front_url",
                "icon_url",
                "logo_url",
            ):
                if not urls.get(key) and std_urls.get(key):
                    urls[key] = std_urls[key]

    full_single_swap = bool(
        single_edition
        and _resolve_standard_edition(edition_folder).resolve()
        == _resolve_standard_edition(single_edition).resolve()
    )
    if not full_single_swap:
        album_artwork: Path | None = None
        if ctx and ctx.release_content:
            album_artwork = _standard_artwork_dir(
                _resolve_standard_edition(ctx.release_content)
            )
        if not album_artwork:
            album_artwork = _standard_artwork_dir(_edition_folder_for_audio(audio_file))
        urls = apply_track_artwork_overrides(urls, album_artwork, title, media_root)

    logo_url = urls.get("logo_url")
    if not logo_url and ctx and ctx.release_content:
        standard_artwork = _standard_artwork_dir(
            _resolve_standard_edition(ctx.release_content)
        )
        if standard_artwork:
            logo_url = _artwork_urls(standard_artwork, media_root).get("logo_url")
    bg_layers = [
        u
        for u in (
            urls.get("cover_inner_url"),
            urls.get("cover_back_url"),
            urls.get("cover_front_url"),
        )
        if u
    ]

    group_dir, group_label = _disc_group_for_audio(audio_file)
    edition_artwork = artwork
    disc_url = resolve_disc_url_for_group(
        edition_artwork,
        group_dir,
        media_root,
        group_label,
        release_content=ctx.release_content if ctx else None,
    )

    photo_landscape_url: str | None = None
    photo_portrait_url: str | None = None
    try:
        from app.release_photo_art import (
            ORIENTATION_FALLBACK_CHAIN,
            resolve_photo_in_single_edition,
            resolve_standard_photo,
        )

        release_dir = (
            ctx.release_content
            if ctx and ctx.release_content
            else _edition_folder_for_audio(audio_file)
        )
        for ori in ("landscape", "portrait"):
            hit = resolve_photo_in_single_edition(
                release_dir,
                edition_folder,
                ORIENTATION_FALLBACK_CHAIN[ori],
            )
            if not hit:
                hit = resolve_standard_photo(release_dir, ori)
            if hit:
                url = _media_url(hit.path, media_root)
                if ori == "landscape":
                    photo_landscape_url = url
                else:
                    photo_portrait_url = url
    except Exception:
        pass

    return {
        "cover_url": urls.get("cover_front_url"),
        "cover_back_url": urls.get("cover_back_url"),
        "cover_animation_url": urls.get("cover_animation_url"),
        "canvas_url": urls.get("canvas_url"),
        "visualizer_url": urls.get("visualizer_url"),
        "cover_landscape_url": urls.get("cover_landscape_url"),
        "cover_portrait_url": urls.get("cover_portrait_url"),
        "cover_banner_url": urls.get("cover_banner_url"),
        "photo_landscape_url": photo_landscape_url,
        "photo_portrait_url": photo_portrait_url,
        "icon_url": urls.get("icon_url"),
        "disc_url": disc_url,
        "logo_url": logo_url,
        "group_kind": _playback_group_kind(group_label),
        "background_layers": bg_layers,
        "is_single": bool(single_edition)
        or bool(_single_root_for_audio(audio_file, media_root)),
    }


def playback_art_for_play_path(
    media_root: Path,
    play_path: str,
    *,
    ctx: PlaybackArtContext | None = None,
) -> dict[str, list[str] | str | None] | None:
    if not play_path:
        return None
    audio_file = media_root / Path(play_path)
    if not audio_file.is_file():
        return None
    return playback_art_for_audio_file(audio_file, media_root, ctx=ctx)


def artwork_gallery_for_play_path(
    media_root: Path,
    play_path: str,
    *,
    ctx: PlaybackArtContext | None = None,
) -> list[dict]:
    if not play_path:
        return []
    audio_file = media_root / Path(play_path)
    if not audio_file.is_file():
        return []
    edition_folder = _artwork_root_for_audio(audio_file, media_root, ctx)
    art_dir = _standard_artwork_dir(edition_folder)
    if not art_dir or not art_dir.is_dir():
        return []
    items: list[dict] = []
    for path in sorted(art_dir.iterdir(), key=lambda p: p.name.casefold()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTS:
            continue
        stem = path.stem.casefold()
        if _is_photocard_stem(stem) or _is_excluded_artwork(stem):
            continue
        # Never surface Exclusive / NSFW dumps into visualizer pools.
        if "exclusive" in stem or "/exclusive/" in path.as_posix().casefold():
            continue
        items.append(_scan_artwork_file(path, media_root))
    return items


def _subject_artist_for_visualizer(
    audio_file: Path,
    *,
    band_name: str | None,
    is_various_artists: bool,
) -> str | None:
    """Album artist normally; for VA prefer By / source_artist / first feat."""
    from app.media_index import parse_bracket_tags
    from app.release_tag_sync import _parse_featuring, _performer_from_stem

    stem = audio_file.stem
    if is_various_artists:
        by_name = _performer_from_stem(stem)
        if by_name:
            return by_name
        _clean, tags = parse_bracket_tags(stem)
        source = (tags.get("source_artist") or "").strip()
        if source:
            return source
    # Featuring guest (first credit) — useful when VA By is missing.
    bracket = re.search(r"\[([^\]]+)\]\s*$", stem)
    if bracket:
        for part in re.split(r"[;:]+", bracket.group(1)):
            feat = _parse_featuring(part.strip())
            if feat:
                return feat[0]
    return band_name


def _artist_era_photo_urls(
    artist_name: str,
    media_root: Path,
    *,
    year: int | None,
    release_title: str | None,
    orientation: str,
    limit: int = 8,
) -> list[str]:
    """Era-scoped dump photos for an artist. Never includes Exclusive."""
    from app.gallery import (
        _artist_dir,
        _gallery_subdir,
        _list_photos,
        _media_url,
    )
    from app.release_gallery import _era_gallery_photos

    artist_dir = _artist_dir(media_root, artist_name)
    if not artist_dir:
        return []
    photos: list = []
    for folder_name in ("Miscellaneous", "Misc", "Gallery", "Photos"):
        d = _gallery_subdir(artist_dir, folder_name)
        if not d or not d.is_dir():
            continue
        # Skip Exclusive even if nested under a misnamed dump.
        if "exclusive" in d.as_posix().casefold():
            continue
        photos.extend(_list_photos(d))
    if not photos:
        return []
    era = _era_gallery_photos(photos, year, release_title) if year else photos
    want = (orientation or "landscape").casefold()
    ordered = [p for p in era if (p.orientation or "").casefold() == want]
    if not ordered:
        ordered = list(era)
    urls: list[str] = []
    for photo in ordered:
        if "exclusive" in photo.path.as_posix().casefold():
            continue
        url = _media_url(photo.path, media_root)
        if url and url not in urls:
            urls.append(url)
        if len(urls) >= limit:
            break
    return urls


def _artist_era_branding(
    artist_name: str,
    media_root: Path,
    *,
    year: int | None,
) -> tuple[str | None, str | None]:
    from app.band_overview import _pick_brand_for_year_deterministic
    from app.gallery import (
        _artist_dir,
        _gallery_subdir,
        _list_era_brands,
        _media_url,
    )
    from app.release_overview import _nearest_brand

    if not year:
        return None, None
    artist_dir = _artist_dir(media_root, artist_name)
    if not artist_dir:
        return None, None
    brands = _list_era_brands(_gallery_subdir(artist_dir, "Branding"))
    if not brands:
        return None, None
    icon = _pick_brand_for_year_deterministic(brands, year, "icon")
    logo = _pick_brand_for_year_deterministic(brands, year, "logo")
    if icon and not logo:
        logo = _nearest_brand(brands, year, "logo")
    if logo and not icon:
        icon = _nearest_brand(brands, year, "icon")
    return (
        _media_url(icon.path, media_root) if icon else None,
        _media_url(logo.path, media_root) if logo else None,
    )


def visualizer_extras_for_play_path(
    media_root: Path,
    play_path: str,
    *,
    ctx: PlaybackArtContext | None = None,
    is_various_artists: bool = False,
    release_date_iso: str | None = None,
    release_title: str | None = None,
) -> dict:
    """Era photos + subject branding for the visualizer overlay.

    Exclusive / NSFW galleries are never included — even when NSFW is unlocked.
    """
    empty = {
        "subject_artist": None,
        "era_icon_url": None,
        "era_logo_url": None,
        "era_photos_landscape": [],
        "era_photos_portrait": [],
    }
    if not play_path:
        return empty
    audio_file = media_root / Path(play_path)
    if not audio_file.is_file():
        return empty

    from app.release_overview import _release_year

    year = _release_year(release_date_iso)
    if year is None and ctx and ctx.release_content:
        from app.band_library import _parse_folder_date

        year = _release_year(_parse_folder_date(ctx.release_content.name))

    subject = _subject_artist_for_visualizer(
        audio_file,
        band_name=ctx.band_name if ctx else None,
        is_various_artists=is_various_artists,
    )
    title = release_title or (ctx.release_title if ctx else None)
    icon_url, logo_url = (
        _artist_era_branding(subject, media_root, year=year)
        if subject
        else (None, None)
    )
    landscape = (
        _artist_era_photo_urls(
            subject,
            media_root,
            year=year,
            release_title=title,
            orientation="landscape",
        )
        if subject
        else []
    )
    portrait = (
        _artist_era_photo_urls(
            subject,
            media_root,
            year=year,
            release_title=title,
            orientation="portrait",
        )
        if subject
        else []
    )
    return {
        "subject_artist": subject,
        "era_icon_url": icon_url,
        "era_logo_url": logo_url,
        "era_photos_landscape": landscape,
        "era_photos_portrait": portrait,
    }
