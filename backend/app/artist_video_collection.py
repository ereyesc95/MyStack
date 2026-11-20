"""Music video discovery beside audio leaves + Series Live Performances helpers."""
from __future__ import annotations

import re
from pathlib import Path

from app.band_library import (
    ARTWORK_DIR,
    AUDIO_CATEGORIES,
    AUDIO_EXTS,
    DATE_PREFIX_RE,
    TRACK_PREFIX_RE,
    VINYL_TRACK_PREFIX_RE,
    _audio_root,
    _artist_dir,
    display_track_title_from_stem,
)
from app.franchise_identity import franchise_letter_dir
from app.franchise_index import parse_dated_folder_name
from app.media_item_overview import VIDEO_EXTS, _file_url, _stem_meta
from app.media_paths_util import safe_relative
from app.release_track_extras import _split_bracket_parts, _youtube_title_keys
from app.series_index import _list_seasons
from app.series_paths import find_content_root

_VIDEO_COLLECTION_RE = re.compile(
    r"(?:\bthe\s+)?video\s+collection\b|\bmusic\s+videos?\b|\bvideo\s+anthology\b",
    re.I,
)
_LIVE_PERFORMANCES_RE = re.compile(
    r"\blive\s+performances?\b|\blive\s+videos?\b|\blive\s+collection\b",
    re.I,
)
_BRACKET_SUFFIX_RE = re.compile(r"\s*\[[^\]]*\]")


def is_video_collection_folder(name: str) -> bool:
    _, title = parse_dated_folder_name(name.strip())
    return bool(_VIDEO_COLLECTION_RE.search(title or name))


def is_live_performances_folder(name: str) -> bool:
    _, title = parse_dated_folder_name(name.strip())
    return bool(_LIVE_PERFORMANCES_RE.search(title or name))


def is_artist_video_series_folder(name: str) -> bool:
    """Video Collection / Music Videos / Live Performances compilations."""
    return is_video_collection_folder(name) or is_live_performances_folder(name)


def find_artist_series_franchise(media_root: Path, artist_name: str) -> Path | None:
    return franchise_letter_dir(media_root, "Series", artist_name)


def iter_video_collection_dirs(franchise_dir: Path) -> list[Path]:
    if not franchise_dir.is_dir():
        return []
    out: list[Path] = []
    for child in sorted(franchise_dir.iterdir(), key=lambda p: p.name.casefold()):
        if child.is_dir() and is_video_collection_folder(child.name):
            out.append(child)
    return out


def iter_live_performances_dirs(franchise_dir: Path) -> list[Path]:
    if not franchise_dir.is_dir():
        return []
    out: list[Path] = []
    for child in sorted(franchise_dir.iterdir(), key=lambda p: p.name.casefold()):
        if child.is_dir() and is_live_performances_folder(child.name):
            out.append(child)
    return out


def _normalize_live_title(title: str) -> str:
    cleaned = _BRACKET_SUFFIX_RE.sub("", (title or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned.casefold()


def scan_live_performances_for_band(band_name: str, media_root: Path) -> list[dict]:
    """All live-performance videos under the artist's Series Live Performances folders."""
    franchise = find_artist_series_franchise(media_root, band_name)
    if not franchise:
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for release_dir in iter_live_performances_dirs(franchise):
        for row in scan_video_collection_release(release_dir, media_root):
            play_path = (row.get("play_path") or "").strip()
            if not play_path or play_path in seen:
                continue
            seen.add(play_path)
            title = (row.get("title") or "").strip()
            if not title:
                continue
            out.append(row)
    out.sort(key=lambda r: (r.get("date_iso") or "9999", (r.get("title") or "").casefold()))
    return out


def match_live_performances_for_release(
    *,
    band_name: str,
    media_root: Path,
    release_title: str,
    release_date_iso: str | None,
) -> list[dict]:
    """Videos whose filename title/date match a Live Album release."""
    release_key = _normalize_live_title(release_title)
    release_date = (release_date_iso or "").strip()[:10] or None
    if not release_key:
        return []
    matches: list[dict] = []
    for row in scan_live_performances_for_band(band_name, media_root):
        video_key = _normalize_live_title(str(row.get("title") or ""))
        if not video_key:
            continue
        video_date = (row.get("date_iso") or "").strip()[:10] or None
        if video_key != release_key:
            continue
        if release_date and video_date and release_date != video_date:
            continue
        matches.append(row)
    return matches

def _video_rows_in_dir(folder: Path, media_root: Path) -> list[dict]:
    rows: list[dict] = []
    try:
        children = sorted(folder.iterdir(), key=lambda p: p.name.casefold())
    except OSError:
        return rows
    for child in children:
        if child.is_file() and child.suffix.lower() in VIDEO_EXTS:
            rel = safe_relative(child, media_root)
            if not rel:
                continue
            title, date_iso, display_date = _stem_meta(child.name)
            rows.append(
                {
                    "title": title,
                    "date_iso": date_iso,
                    "display_date": display_date,
                    "play_path": rel.replace("\\", "/"),
                    "open_url": _file_url(child, media_root),
                }
            )
        elif child.is_dir():
            rows.extend(_video_rows_in_dir(child, media_root))
    return rows


def scan_video_collection_release(release_dir: Path, media_root: Path) -> list[dict]:
    _, collection_title = parse_dated_folder_name(release_dir.name)
    content = find_content_root(release_dir)
    rows: list[dict] = []
    if content != release_dir:
        rows.extend(_video_rows_in_dir(content, media_root))
    seasons = _list_seasons(release_dir, media_root)
    if seasons:
        for season in seasons:
            folder_path = (season.get("folder_path") or "").strip()
            if not folder_path:
                continue
            season_dir = media_root / Path(folder_path.replace("/", "\\"))
            if not season_dir.is_dir():
                season_dir = media_root / Path(folder_path)
            if season_dir.is_dir():
                rows.extend(_video_rows_in_dir(season_dir, media_root))
    if not rows:
        rows.extend(_video_rows_in_dir(release_dir, media_root))
    out: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        play_path = (row.get("play_path") or "").strip()
        if not play_path or play_path in seen:
            continue
        seen.add(play_path)
        title = (row.get("title") or "").strip()
        if not title:
            continue
        date_iso = row.get("date_iso")
        if not date_iso:
            stem = Path(play_path).name
            _, date_iso, display_date = _stem_meta(stem)
            row["date_iso"] = date_iso
            row["display_date"] = display_date
        out.append(
            {
                **row,
                "collection_title": collection_title,
                "collection_path": safe_relative(release_dir, media_root),
            }
        )
    return out


def _strip_track_prefixes(stem: str) -> str:
    after_num = TRACK_PREFIX_RE.sub("", stem.strip()).strip()
    vinyl = VINYL_TRACK_PREFIX_RE.match(after_num)
    if vinyl:
        rest = after_num[vinyl.end() :].lstrip(". ").strip()
        if rest:
            return rest
    return after_num


def parse_music_video_filename(name: str) -> dict[str, str | None]:
    """Parse ``{NN}. {Title}[Label].ext`` beside an audio leaf."""
    stem = Path(name).stem
    rest = _strip_track_prefixes(stem)
    main, parts = _split_bracket_parts(rest)
    label = "; ".join(parts) if parts else None
    display = display_track_title_from_stem(stem)
    return {
        "title": (main or rest).strip() or display,
        "label": label,
        "display_title": display,
    }


def _folder_date_iso(folder: Path) -> str | None:
    date_iso, _ = parse_dated_folder_name(folder.name)
    if date_iso:
        return date_iso
    m = DATE_PREFIX_RE.match(folder.name.strip())
    if not m:
        return None
    y, mo, d = m.group(1), m.group(2), m.group(3)
    return f"{y}-{mo or '01'}-{d or '01'}"


def _release_date_walking_up(leaf: Path, stop_at: Path) -> str | None:
    cur = leaf
    stop = stop_at.resolve()
    for _ in range(12):
        try:
            if cur.resolve() == stop:
                break
        except OSError:
            break
        found = _folder_date_iso(cur)
        if found:
            return found
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def _path_is_under_singles(rel: str) -> bool:
    parts = rel.replace("\\", "/").casefold().split("/")
    return "singles" in parts


def _iter_audio_media_leaves(artist_dir: Path) -> list[Path]:
    """Folders under Albums/Singles/… that contain audio or video files."""
    audio = _audio_root(artist_dir)
    if not audio.is_dir():
        return []
    leaves: list[Path] = []
    seen: set[str] = set()
    for folder_name in AUDIO_CATEGORIES.values():
        cat = audio / folder_name
        if not cat.is_dir():
            # Case-insensitive resolve
            try:
                match = next(
                    (
                        c
                        for c in audio.iterdir()
                        if c.is_dir() and c.name.casefold() == folder_name.casefold()
                    ),
                    None,
                )
            except OSError:
                match = None
            if not match:
                continue
            cat = match
        for dirpath, dirnames, filenames in __import__("os").walk(cat):
            dirnames[:] = [
                d for d in dirnames if d.casefold() != ARTWORK_DIR.casefold()
            ]
            folder = Path(dirpath)
            has_media = False
            for name in filenames:
                ext = Path(name).suffix.lower()
                if ext in AUDIO_EXTS or ext in VIDEO_EXTS:
                    has_media = True
                    break
            if not has_media:
                continue
            key = str(folder.resolve())
            if key in seen:
                continue
            seen.add(key)
            leaves.append(folder)
    return leaves


def _video_row_from_leaf_file(
    video_file: Path,
    *,
    media_root: Path,
    leaf: Path,
    artist_audio_root: Path,
) -> dict | None:
    rel = safe_relative(video_file, media_root)
    if not rel:
        return None
    rel = rel.replace("\\", "/")
    meta = parse_music_video_filename(video_file.name)
    title = (meta.get("title") or "").strip()
    if not title:
        return None
    date_iso = _release_date_walking_up(leaf, artist_audio_root)
    return {
        "title": title,
        "display_title": meta.get("display_title") or title,
        "label": meta.get("label"),
        "date_iso": date_iso,
        "display_date": None,
        "play_path": rel,
        "open_url": _file_url(video_file, media_root),
        "leaf_path": safe_relative(leaf, media_root),
        "is_single": _path_is_under_singles(rel),
    }


def scan_music_videos_in_leaf(leaf: Path, media_root: Path, *, artist_audio_root: Path) -> list[dict]:
    """Direct video files in one audio leaf (not recursive)."""
    if not leaf.is_dir():
        return []
    rows: list[dict] = []
    try:
        children = sorted(leaf.iterdir(), key=lambda p: p.name.casefold())
    except OSError:
        return []
    for child in children:
        if not child.is_file() or child.suffix.lower() not in VIDEO_EXTS:
            continue
        row = _video_row_from_leaf_file(
            child,
            media_root=media_root,
            leaf=leaf,
            artist_audio_root=artist_audio_root,
        )
        if row:
            rows.append(row)
    return rows


def local_videos_index_for_band(band_name: str, media_root: Path) -> dict[str, list[dict]]:
    """Map ``title_key|date_iso`` → MV rows beside Music audio leaves (clean cut from Series)."""
    artist_dir = _artist_dir(media_root, band_name)
    if not artist_dir:
        return {}
    audio_root = _audio_root(artist_dir)
    index: dict[str, list[dict]] = {}
    for leaf in _iter_audio_media_leaves(artist_dir):
        for row in scan_music_videos_in_leaf(
            leaf, media_root, artist_audio_root=audio_root
        ):
            title = (row.get("title") or "").strip()
            keys = _youtube_title_keys(title)
            if not keys:
                continue
            date_iso = (row.get("date_iso") or "").strip()
            for key in keys:
                bucket_key = f"{key}|{date_iso}"
                index.setdefault(bucket_key, []).append(row)
    return index


def _dated_videos_for_key(index: dict[str, list[dict]], key: str) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    for bucket_key, rows in index.items():
        if not bucket_key.startswith(f"{key}|") or not rows:
            continue
        date_part = bucket_key.split("|", 1)[1]
        if not date_part:
            continue
        out.append((date_part, rows[0]))
    out.sort(key=lambda item: item[0])
    return out


def local_videos_for_title(
    index: dict[str, list[dict]],
    title: str,
) -> list[dict]:
    """All local collection videos whose filename title matches the track."""
    keys = _youtube_title_keys(title)
    if not keys:
        return []
    seen: set[str] = set()
    out: list[dict] = []
    for key in keys:
        for bucket_key, rows in index.items():
            if not bucket_key.startswith(f"{key}|") or not rows:
                continue
            date_part = bucket_key.split("|", 1)[1]
            if not date_part:
                continue
            for row in rows:
                play_path = (row.get("play_path") or "").strip()
                if not play_path or play_path in seen:
                    continue
                seen.add(play_path)
                out.append(row)
    out.sort(key=lambda row: (row.get("date_iso") or "", row.get("title") or ""))
    return out


def _prefer_singles_first(rows: list[dict]) -> list[dict]:
    return sorted(
        rows,
        key=lambda r: (
            0 if r.get("is_single") else 1,
            r.get("date_iso") or "",
            (r.get("label") or ""),
            r.get("play_path") or "",
        ),
    )


def local_video_dicts_for_title(
    index: dict[str, list[dict]],
    title: str,
) -> list[dict[str, str | bool]]:
    """TrackOverride-style video rows from local files only (Singles preferred)."""
    rows = _prefer_singles_first(local_videos_for_title(index, title))
    if not rows:
        return []
    out: list[dict[str, str | bool]] = []
    for i, row in enumerate(rows):
        play_path = (row.get("play_path") or "").strip()
        if not play_path:
            continue
        date_iso = (row.get("date_iso") or "").strip()
        label = (row.get("label") or "").strip()
        if not label:
            label = "Official video" if len(rows) == 1 else f"Version {i + 1}"
        item: dict[str, str | bool] = {
            "url": "",
            "label": label,
            "primary": i == 0,
            "local_path": play_path,
        }
        if date_iso:
            item["release_date"] = date_iso
        out.append(item)
    return out


def match_local_video(
    index: dict[str, list[dict]],
    *,
    title: str,
    release_date: str | None = None,
    prefer_leaf_path: str | None = None,
) -> dict | None:
    """Pick a local MV: Singles first, else same leaf as the audio, else dated match."""
    rows = local_videos_for_title(index, title)
    if not rows:
        return None
    leaf_norm = (prefer_leaf_path or "").replace("\\", "/").casefold().rstrip("/")
    if leaf_norm:
        in_leaf = [
            r
            for r in rows
            if (r.get("leaf_path") or "").replace("\\", "/").casefold().rstrip("/")
            == leaf_norm
            or (r.get("play_path") or "").replace("\\", "/").casefold().rsplit("/", 1)[0]
            == leaf_norm
        ]
        if in_leaf:
            return _prefer_singles_first(in_leaf)[0]
    singles = [r for r in rows if r.get("is_single")]
    if singles:
        return _prefer_singles_first(singles)[0]

    date_iso = (release_date or "").strip()
    if len(date_iso) >= 10:
        date_iso = date_iso[:10]
    elif len(date_iso) == 4 and date_iso.isdigit():
        date_iso = f"{date_iso}-01-01"

    keys = _youtube_title_keys(title)
    for key in keys:
        if date_iso:
            hits = index.get(f"{key}|{date_iso}")
            if hits:
                return _prefer_singles_first(hits)[0]
            year = date_iso[:4]
            if year.isdigit():
                in_year = [
                    row
                    for row_date, row in _dated_videos_for_key(index, key)
                    if row_date.startswith(year)
                ]
                if len(in_year) == 1:
                    return in_year[0]
        dated = _dated_videos_for_key(index, key)
        if len(dated) == 1:
            return dated[0][1]
    return _prefer_singles_first(rows)[0]
