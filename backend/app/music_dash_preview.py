"""Resolve lightweight media candidates for Music dashboard card hover previews."""
from __future__ import annotations

import random
import time
from pathlib import Path
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.band_library import (
    AUDIO_EXTS,
    ARTWORK_DIR,
    _artist_dir,
    artwork_role_urls_for_track_path,
    display_track_title_from_path,
    resolve_track_file_path,
)
from app.config import settings
from app.media_item_overview import VIDEO_EXTS
from app.media_paths_util import safe_relative
from app.models import Band
from app.release_track_extras import _youtube_title_keys

PreviewKind = Literal["track", "artist", "release", "genre", "country"]

_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SEC = 120.0
_CACHE_MAX = 256


def _cache_get(key: str) -> dict[str, Any] | None:
    hit = _CACHE.get(key)
    if not hit:
        return None
    ts, payload = hit
    if time.monotonic() - ts > _CACHE_TTL_SEC:
        _CACHE.pop(key, None)
        return None
    return dict(payload)


def _cache_set(key: str, payload: dict[str, Any]) -> None:
    if len(_CACHE) >= _CACHE_MAX:
        # Drop oldest ~25%
        for k, _ in sorted(_CACHE.items(), key=lambda kv: kv[1][0])[:64]:
            _CACHE.pop(k, None)
    _CACHE[key] = (time.monotonic(), dict(payload))


def clear_music_dash_preview_cache() -> None:
    _CACHE.clear()


def _media_root() -> Path:
    return Path(settings.media_root)


def _stream_url(rel: str, *, video: bool) -> str:
    from urllib.parse import quote

    path = rel.replace("\\", "/")
    # Encode the whole path (including slashes) — matches frontend musicStreamUrl.
    q = quote(path, safe="")
    if video:
        return f"/api/media/file?path={q}"
    return f"/api/music/stream?path={q}"


def _pick_artwork(path: str | None, media_root: Path) -> str | None:
    if not path:
        return None
    roles = artwork_role_urls_for_track_path(path, media_root) or {}
    return (
        roles.get("banner_url")
        or roles.get("landscape_url")
        or roles.get("cover_url")
        or None
    )


def _is_silent_cover_video(filename: str) -> bool:
    """Packaging videos with no soundtrack — never use as dash hover previews.

    Matches ``Cover - Animation``, ``Cover - Canvas``, and ``Cover - {track title}``.
    """
    stem = Path(filename).stem.strip().casefold()
    if not stem.startswith("cover - "):
        return False
    return True


def _list_videos_in_dir(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    out: list[Path] = []
    try:
        for child in folder.iterdir():
            if (
                child.is_file()
                and child.suffix.lower() in VIDEO_EXTS
                and not _is_silent_cover_video(child.name)
            ):
                out.append(child)
    except OSError:
        return []
    return out


def _list_audio_in_dir(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    out: list[Path] = []
    try:
        for child in folder.iterdir():
            if child.is_file() and child.suffix.lower() in AUDIO_EXTS:
                out.append(child)
    except OSError:
        return []
    return out


def _classify_leaf_videos(
    leaf: Path, media_root: Path
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (music_videos, other_videos) in a leaf beside audio."""
    from app.artist_video_collection import parse_music_video_filename

    audio_keys: set[str] = set()
    for audio in _list_audio_in_dir(leaf):
        title = display_track_title_from_path(audio)
        for key in _youtube_title_keys(title):
            audio_keys.add(key)
    mvs: list[dict[str, Any]] = []
    others: list[dict[str, Any]] = []
    for video in _list_videos_in_dir(leaf):
        meta = parse_music_video_filename(video.name)
        title = str(meta.get("title") or "").strip()
        keys = _youtube_title_keys(title)
        rel = safe_relative(video, media_root)
        if not rel:
            continue
        rel = rel.replace("\\", "/")
        row = {
            "path": rel,
            "title": title or display_track_title_from_path(video),
            "label": meta.get("label"),
            "url": _stream_url(rel, video=True),
        }
        if keys and any(k in audio_keys for k in keys):
            mvs.append(row)
        else:
            others.append(row)
    return mvs, others


def _audio_parent_leaf(audio_file: Path) -> Path:
    return audio_file.parent


def _resolve_track_file(media_root: Path, play_path: str) -> Path | None:
    return resolve_track_file_path(play_path, media_root)


def _artist_name_from_rel(rel: str) -> str | None:
    parts = [p for p in rel.replace("\\", "/").split("/") if p]
    if len(parts) >= 3 and parts[0].casefold() == "music":
        return parts[2]
    return None


def _preview_from_video(row: dict[str, Any], artwork: str | None = None) -> dict[str, Any]:
    path = (row.get("path") or row.get("play_path") or "").replace("\\", "/")
    url = row.get("url") or (_stream_url(path, video=True) if path else None)
    if not url:
        return {
            "media_kind": "video",
            "media_url": "",
            "title": row.get("label") or row.get("title") or "Video",
            "artwork_url": artwork,
            "path": path or None,
        }
    return {
        "media_kind": "video",
        "media_url": url,
        "title": row.get("label") or row.get("title") or "Video",
        "artwork_url": artwork,
        "path": path or None,
    }


def _preview_from_audio(
    audio_file: Path, media_root: Path, *, title: str | None = None
) -> dict[str, Any] | None:
    rel = safe_relative(audio_file, media_root)
    if not rel:
        return None
    rel = rel.replace("\\", "/")
    display = title or display_track_title_from_path(audio_file)
    return {
        "media_kind": "audio",
        "media_url": _stream_url(rel, video=False),
        "title": display,
        "artwork_url": _pick_artwork(rel, media_root),
        "path": rel,
    }


def _preview_from_local_mv_row(
    row: dict[str, Any], artwork: str | None
) -> dict[str, Any] | None:
    path = (row.get("play_path") or row.get("path") or "").replace("\\", "/")
    if not path:
        return None
    if _is_silent_cover_video(Path(path).name):
        return None
    return {
        "media_kind": "video",
        "media_url": _stream_url(path, video=True),
        "title": row.get("label") or row.get("display_title") or row.get("title") or "Video",
        "artwork_url": artwork,
        "path": path,
    }


def _resolve_track_preview(play_path: str, media_root: Path) -> dict[str, Any] | None:
    """On Repeat / track cards: Singles MV first, then the play-path release leaf, else audio."""
    from app.artist_video_collection import (
        _prefer_singles_first,
        local_videos_for_title,
        local_videos_index_for_band,
    )

    audio = _resolve_track_file(media_root, play_path)
    if not audio:
        return None
    leaf = _audio_parent_leaf(audio)
    track_title = display_track_title_from_path(audio)
    artwork = _pick_artwork(play_path, media_root)
    rel_audio = safe_relative(audio, media_root)
    artist_name = _artist_name_from_rel(rel_audio or play_path)

    if artist_name:
        index = local_videos_index_for_band(artist_name, media_root)
        rows = [
            r
            for r in local_videos_for_title(index, track_title)
            if not _is_silent_cover_video(
                Path(str(r.get("play_path") or r.get("path") or "")).name
            )
        ]
        singles = [r for r in rows if r.get("is_single")]
        if singles:
            hit = _preview_from_local_mv_row(
                _prefer_singles_first(singles)[0], artwork
            )
            if hit:
                return hit

        leaf_rel = (safe_relative(leaf, media_root) or "").replace("\\", "/").casefold().rstrip("/")
        if leaf_rel:
            in_leaf = [
                r
                for r in rows
                if (r.get("leaf_path") or "").replace("\\", "/").casefold().rstrip("/")
                == leaf_rel
                or (r.get("play_path") or "")
                .replace("\\", "/")
                .casefold()
                .rsplit("/", 1)[0]
                == leaf_rel
            ]
            if in_leaf:
                hit = _preview_from_local_mv_row(
                    _prefer_singles_first(in_leaf)[0], artwork
                )
                if hit:
                    return hit

    # Direct leaf scan (covers sparse index misses)
    mvs, _others = _classify_leaf_videos(leaf, media_root)
    track_keys = set(_youtube_title_keys(track_title))
    matching = [
        row
        for row in mvs
        if set(_youtube_title_keys(str(row.get("title") or ""))) & track_keys
    ]
    if matching:
        return _preview_from_video(random.choice(matching), artwork)
    return _preview_from_audio(audio, media_root, title=track_title)


def _iter_artist_leaves(artist_dir: Path) -> list[Path]:
    from app.artist_video_collection import _iter_audio_media_leaves

    return _iter_audio_media_leaves(artist_dir)


def _resolve_artist_preview(band: Band, media_root: Path) -> dict[str, Any] | None:
    artist_dir = _artist_dir(media_root, band.bnd_name or "")
    if not artist_dir:
        return None
    mvs: list[dict[str, Any]] = []
    others: list[dict[str, Any]] = []
    audios: list[Path] = []
    for leaf in _iter_artist_leaves(artist_dir):
        mv, ot = _classify_leaf_videos(leaf, media_root)
        mvs.extend(mv)
        others.extend(ot)
        audios.extend(_list_audio_in_dir(leaf))
    if mvs:
        return _preview_from_video(random.choice(mvs))
    if others:
        return _preview_from_video(random.choice(others))
    if audios:
        return _preview_from_audio(random.choice(audios), media_root)
    return None


def _release_dir_from_folder(folder_path: str, media_root: Path) -> Path | None:
    rid = (folder_path or "").strip().replace("\\", "/")
    if not rid:
        return None
    for candidate in (
        media_root / Path(rid.replace("/", "\\")),
        media_root / rid,
    ):
        if candidate.is_dir():
            return candidate
    return None


def _resolve_release_preview(
    db: Session,
    release_id: str,
    media_root: Path,
    *,
    folder_path: str | None = None,
) -> dict[str, Any] | None:
    release_dir = _release_dir_from_folder(folder_path or release_id, media_root)
    if not release_dir:
        return None
    mvs: list[dict[str, Any]] = []
    others: list[dict[str, Any]] = []
    audios: list[Path] = []
    for dirpath, dirnames, _filenames in __import__("os").walk(release_dir):
        dirnames[:] = [d for d in dirnames if d.casefold() != ARTWORK_DIR.casefold()]
        leaf = Path(dirpath)
        mv, ot = _classify_leaf_videos(leaf, media_root)
        mvs.extend(mv)
        others.extend(ot)
        audios.extend(_list_audio_in_dir(leaf))
    if mvs:
        return _preview_from_video(random.choice(mvs))
    if others:
        return _preview_from_video(random.choice(others))
    if audios:
        return _preview_from_audio(random.choice(audios), media_root)
    return None


def _bands_for_genre(db: Session, genre_id: int) -> list[Band]:
    """Dashboard genre ids are subgenre ids stored in ``bnd_fk_subgenres``."""
    from sqlalchemy import select

    needle = str(genre_id)
    out: list[Band] = []
    # Prefilter with LIKE then exact ;-split match (avoids 200 matching 2000).
    rough = db.scalars(
        select(Band).where(Band.bnd_fk_subgenres.like(f"%{needle}%")).limit(120)
    ).all()
    for band in rough:
        parts = [
            p.strip()
            for p in (band.bnd_fk_subgenres or "").split(";")
            if p.strip()
        ]
        if needle in parts:
            out.append(band)
        if len(out) >= 40:
            break
    return out


def _bands_for_country(db: Session, country_id: int | None, country_name: str | None) -> list[Band]:
    from sqlalchemy import select

    from app.music_dashboard import _parse_country_id
    from app.models import Country

    out: list[Band] = []
    name = (country_name or "").strip().casefold()
    q = select(Band)
    if country_id is not None:
        q = q.where(Band.bnd_fk_countries.like(f"%{country_id}%")).limit(120)
    else:
        q = q.limit(200)
    for band in db.scalars(q).all():
        cid = _parse_country_id(band.bnd_fk_countries)
        if country_id is not None and cid == country_id:
            out.append(band)
        elif name and cid is not None:
            row = db.get(Country, cid)
            if row and (row.cou_name or "").casefold() == name:
                out.append(band)
        if len(out) >= 40:
            break
    return out


def _resolve_from_bands(bands: list[Band], media_root: Path) -> dict[str, Any] | None:
    if not bands:
        return None
    sample = list(bands)
    random.shuffle(sample)
    mvs: list[dict[str, Any]] = []
    others: list[dict[str, Any]] = []
    audios: list[Path] = []
    # Cap disk walks for dashboard hover — lightweight + still random.
    for band in sample[:8]:
        artist_dir = _artist_dir(media_root, band.bnd_name or "")
        if not artist_dir:
            continue
        for leaf in _iter_artist_leaves(artist_dir)[:20]:
            mv, ot = _classify_leaf_videos(leaf, media_root)
            mvs.extend(mv)
            others.extend(ot)
            audios.extend(_list_audio_in_dir(leaf))
        if len(mvs) + len(others) + len(audios) >= 24:
            break
    if mvs:
        return _preview_from_video(random.choice(mvs))
    if others:
        return _preview_from_video(random.choice(others))
    if audios:
        return _preview_from_audio(random.choice(audios), media_root)
    return None


def resolve_music_dash_preview(
    db: Session,
    *,
    kind: PreviewKind,
    path: str | None = None,
    artist_id: int | None = None,
    release_id: str | None = None,
    folder_path: str | None = None,
    genre_id: int | None = None,
    country_id: int | None = None,
    country_name: str | None = None,
) -> dict[str, Any] | None:
    cache_key = "|".join(
        [
            kind,
            path or "",
            str(artist_id or ""),
            release_id or "",
            folder_path or "",
            str(genre_id or ""),
            str(country_id or ""),
            (country_name or ""),
        ]
    )
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached if cached.get("media_url") else None

    media_root = _media_root()
    result: dict[str, Any] | None = None

    if kind == "track" and path:
        result = _resolve_track_preview(path, media_root)
    elif kind == "artist" and artist_id is not None:
        band = db.get(Band, artist_id)
        if band:
            result = _resolve_artist_preview(band, media_root)
            if result:
                result["artist_name"] = band.bnd_name
    elif kind == "release":
        result = _resolve_release_preview(
            db, release_id or "", media_root, folder_path=folder_path
        )
    elif kind == "genre" and genre_id is not None:
        bands = _bands_for_genre(db, genre_id)
        result = _resolve_from_bands(bands, media_root)
        if result and bands:
            result["artist_name"] = random.choice(bands).bnd_name
    elif kind == "country":
        bands = _bands_for_country(db, country_id, country_name)
        result = _resolve_from_bands(bands, media_root)
        if result and bands:
            result["artist_name"] = random.choice(bands).bnd_name

    if result:
        # Enrich artist art when we have a name
        name = result.get("artist_name")
        if name:
            try:
                from app.music_dashboard import _resolve_artist_card_cached

                card = _resolve_artist_card_cached(str(name), user_id=0)
                result["artist_logo_url"] = card.logo_url
                result["artist_logo_collapsed_url"] = card.logo_collapsed_url
                result["artist_icon_url"] = card.icon_url
            except Exception:
                pass
        _cache_set(cache_key, result)
    else:
        _cache_set(cache_key, {})
    return result or None
