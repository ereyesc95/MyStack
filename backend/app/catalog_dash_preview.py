"""Lightweight dash-card preview candidates for Series / Movies (and later Games/Books)."""
from __future__ import annotations

import random
import re
import time
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.band_library import artwork_role_urls_for_track_path, display_track_title_from_path
from app.config import settings
from app.media_item_overview import VIDEO_EXTS
from app.media_paths_util import safe_relative
from app.series_paths import find_audio_bucket, find_episodes_root, find_extras_dir

PreviewModule = Literal["series", "movies"]
PreviewKind = Literal[
    "show",
    "franchise",
    "universe",
    "genre",
    "country",
    "film",
]

_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SEC = 120.0
_CACHE_MAX = 256
_TRAILER_RE = re.compile(r"\btrailers?\b", re.I)
_OPENING_RE = re.compile(r"\[([^\]]*opening[^\]]*)\]|\bopenings?\b", re.I)


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
        for k, _ in sorted(_CACHE.items(), key=lambda kv: kv[1][0])[:64]:
            _CACHE.pop(k, None)
    _CACHE[key] = (time.monotonic(), dict(payload))


def _media_root() -> Path | None:
    root = Path(settings.media_root) if settings.media_root else None
    return root if root and root.is_dir() else None


def _file_url(rel: str, *, video: bool) -> str:
    q = quote(rel.replace("\\", "/"), safe="")
    if video:
        return f"/api/media/file?path={q}"
    return f"/api/music/stream?path={q}"


def _strip_brackets(title: str) -> str:
    return re.sub(r"\s*\[[^\]]*\]", "", title or "").strip()


def _video_preview(
    path: Path,
    media_root: Path,
    *,
    title: str | None = None,
    series_title: str | None = None,
) -> dict[str, Any] | None:
    rel = safe_relative(path, media_root)
    if not rel:
        return None
    rel = rel.replace("\\", "/")
    display = _strip_brackets(title or display_track_title_from_path(path) or path.stem)
    out: dict[str, Any] = {
        "media_kind": "video",
        "media_url": _file_url(rel, video=True),
        "title": display,
        "path": rel,
        "artwork_url": None,
    }
    if series_title:
        out["series_title"] = series_title
        out["parent_title"] = series_title
    return out


def _audio_preview(
    path: Path,
    media_root: Path,
    *,
    title: str | None = None,
    series_title: str | None = None,
) -> dict[str, Any] | None:
    rel = safe_relative(path, media_root)
    if not rel:
        return None
    rel = rel.replace("\\", "/")
    roles = artwork_role_urls_for_track_path(rel, media_root) or {}
    out: dict[str, Any] = {
        "media_kind": "audio",
        "media_url": _file_url(rel, video=False),
        "title": _strip_brackets(title or display_track_title_from_path(path)),
        "path": rel,
        "artwork_url": roles.get("banner_url")
        or roles.get("landscape_url")
        or roles.get("cover_url"),
    }
    if series_title:
        out["series_title"] = series_title
        out["parent_title"] = series_title
    return out


def _list_videos(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    try:
        return sorted(
            (
                p
                for p in folder.iterdir()
                if p.is_file() and p.suffix.lower() in VIDEO_EXTS
            ),
            key=lambda p: p.name.casefold(),
        )
    except OSError:
        return []


def _classify_extras(extras_dir: Path) -> tuple[list[Path], list[Path], list[Path]]:
    """Return (openings, trailers, other)."""
    openings: list[Path] = []
    trailers: list[Path] = []
    other: list[Path] = []
    for f in _list_videos(extras_dir):
        name = f.name
        if _OPENING_RE.search(name):
            openings.append(f)
        elif _TRAILER_RE.search(name):
            trailers.append(f)
        else:
            other.append(f)
    return openings, trailers, other


def _extras_preview(
    folder: Path,
    media_root: Path,
    *,
    prefer_opening: bool,
    series_title: str | None = None,
) -> dict[str, Any] | None:
    ex = find_extras_dir(folder)
    if not ex:
        return None
    openings, trailers, other = _classify_extras(ex)
    if prefer_opening and openings:
        return _video_preview(
            random.choice(openings), media_root, series_title=series_title
        )
    if trailers:
        return _video_preview(
            random.choice(trailers), media_root, series_title=series_title
        )
    if not prefer_opening and openings:
        return _video_preview(
            random.choice(openings), media_root, series_title=series_title
        )
    if other:
        return _video_preview(
            random.choice(other), media_root, series_title=series_title
        )
    return None


def _episode_files(folder: Path) -> list[Path]:
    """Lowest season/episode first (by path name)."""
    root = find_episodes_root(folder)
    found: list[Path] = []
    try:
        for dirpath, dirnames, filenames in __import__("os").walk(root):
            # Prefer season folders ordered by name
            dirnames.sort(key=lambda n: n.casefold())
            leaf = Path(dirpath)
            for name in sorted(filenames, key=lambda n: n.casefold()):
                p = leaf / name
                if p.suffix.lower() in VIDEO_EXTS:
                    found.append(p)
            if len(found) >= 40:
                break
    except OSError:
        return found
    return found


def _first_episode_preview(
    folder: Path, media_root: Path, *, series_title: str | None = None
) -> dict[str, Any] | None:
    eps = _episode_files(folder)
    if not eps:
        return None
    return _video_preview(eps[0], media_root, series_title=series_title)


def _any_video_preview(
    folder: Path, media_root: Path, *, series_title: str | None = None
) -> dict[str, Any] | None:
    eps = _episode_files(folder)
    if not eps:
        return None
    return _video_preview(random.choice(eps[:12]), media_root, series_title=series_title)


def _audio_from_folder(
    db: Session,
    folder: Path,
    media_root: Path,
    *,
    series_title: str | None = None,
) -> dict[str, Any] | None:
    from app.series_extras import collect_audio_tracks_from_folders

    if not find_audio_bucket(folder):
        return None
    tracks = collect_audio_tracks_from_folders(
        db, [folder], media_root, shortcuts_only=True
    )
    if not tracks:
        return None
    pick = random.choice(tracks[:24])
    play = (pick.get("play_path") or pick.get("path") or "").strip()
    if not play:
        return None
    audio = media_root / Path(play.replace("/", "\\"))
    if not audio.is_file():
        audio = media_root / play
    if not audio.is_file():
        return None
    return _audio_preview(
        audio,
        media_root,
        title=pick.get("title"),
        series_title=series_title,
    )


def _series_folder_chain(
    media_root: Path,
    *,
    franchise_id: str | None,
    subseries_id: str | None,
    folder_path: str | None,
) -> list[tuple[Path, str | None]]:
    """Return [(folder, display_title), ...] to search, most specific first."""
    from app.series_index import _list_subseries, find_franchise_dir

    out: list[tuple[Path, str | None]] = []
    if folder_path:
        p = media_root / Path(folder_path.replace("/", "\\"))
        if p.is_dir():
            out.append((p, p.name))
            return out
    if not franchise_id:
        return out
    found = find_franchise_dir(franchise_id, media_root)
    if not found:
        return out
    franchise_dir, _letter = found
    if subseries_id:
        want = subseries_id.casefold()
        for s in _list_subseries(franchise_dir, media_root):
            sid = (s.get("id") or "").casefold()
            title = (s.get("title") or "").casefold()
            fp = (s.get("folder_path") or "").replace("\\", "/")
            if want in {sid, title} or want in fp.casefold():
                sp = media_root / Path(fp.replace("/", "\\")) if fp else None
                if sp and sp.is_dir():
                    out.append((sp, s.get("title") or sp.name))
                break
    out.append((franchise_dir, franchise_dir.name))
    return out


def _resolve_series_leaf(
    db: Session,
    media_root: Path,
    *,
    franchise_id: str | None,
    subseries_id: str | None,
    folder_path: str | None,
) -> dict[str, Any] | None:
    chain = _series_folder_chain(
        media_root,
        franchise_id=franchise_id,
        subseries_id=subseries_id,
        folder_path=folder_path,
    )
    for folder, title in chain:
        hit = _extras_preview(
            folder, media_root, prefer_opening=True, series_title=title
        )
        if hit:
            return hit
    for folder, title in chain:
        hit = _first_episode_preview(folder, media_root, series_title=title)
        if hit:
            return hit
    for folder, title in chain:
        hit = _any_video_preview(folder, media_root, series_title=title)
        if hit:
            return hit
    for folder, title in chain:
        hit = _audio_from_folder(db, folder, media_root, series_title=title)
        if hit:
            return hit
    return None


def _resolve_series_scope(
    db: Session,
    media_root: Path,
    folders: list[tuple[Path, str | None]],
) -> dict[str, Any] | None:
    """Random among openings → trailers → first eps → any video → audio."""
    if not folders:
        return None
    sample = list(folders)
    random.shuffle(sample)
    sample = sample[:10]

    openings: list[tuple[Path, str | None]] = []
    trailers: list[tuple[Path, str | None]] = []
    for folder, title in sample:
        ex = find_extras_dir(folder)
        if not ex:
            continue
        ops, trs, _oth = _classify_extras(ex)
        openings.extend((p, title) for p in ops)
        trailers.extend((p, title) for p in trs)
    if openings:
        p, title = random.choice(openings)
        return _video_preview(p, media_root, series_title=title)
    if trailers:
        p, title = random.choice(trailers)
        return _video_preview(p, media_root, series_title=title)

    for folder, title in sample:
        hit = _first_episode_preview(folder, media_root, series_title=title)
        if hit:
            return hit
    for folder, title in sample:
        hit = _any_video_preview(folder, media_root, series_title=title)
        if hit:
            return hit
    for folder, title in sample:
        hit = _audio_from_folder(db, folder, media_root, series_title=title)
        if hit:
            return hit
    return None


def _resolve_movie_leaf(
    db: Session,
    media_root: Path,
    *,
    film_id: str | None,
    folder_path: str | None,
) -> dict[str, Any] | None:
    from app.movies_index import find_film_dir

    film_dir: Path | None = None
    title: str | None = None
    if folder_path:
        p = media_root / Path(folder_path.replace("/", "\\"))
        if p.is_dir():
            film_dir = p
            title = p.name
    if film_dir is None and film_id:
        found = find_film_dir(film_id, media_root)
        if found:
            film_dir, _work, _letter = found
            title = film_dir.name
    if not film_dir:
        return None

    hit = _extras_preview(
        film_dir, media_root, prefer_opening=False, series_title=title
    )
    if hit:
        return hit
    # Feature file(s) in the leaf
    videos = _list_videos(film_dir)
    if videos:
        # Prefer longest-looking / non-trailer already filtered
        return _video_preview(videos[0], media_root, series_title=title)
    for child in sorted(film_dir.iterdir(), key=lambda p: p.name.casefold()) if film_dir.is_dir() else []:
        if child.is_dir() and child.name.casefold() not in {
            "extras",
            "[extras]",
            "gallery",
            "audio",
            "[audio]",
            "[artwork]",
            "artwork",
        }:
            nested = _list_videos(child)
            if nested:
                return _video_preview(nested[0], media_root, series_title=title)
    return _audio_from_folder(db, film_dir, media_root, series_title=title)


def resolve_catalog_dash_preview(
    db: Session,
    *,
    module: PreviewModule,
    kind: str,
    franchise_id: str | None = None,
    subseries_id: str | None = None,
    film_id: str | None = None,
    folder_path: str | None = None,
    genre_id: int | None = None,
    country_id: int | None = None,
    country_name: str | None = None,
    universe_id: str | None = None,
) -> dict[str, Any] | None:
    cache_key = "|".join(
        [
            module,
            kind,
            franchise_id or "",
            subseries_id or "",
            film_id or "",
            folder_path or "",
            str(genre_id or ""),
            str(country_id or ""),
            country_name or "",
            universe_id or "",
        ]
    )
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached if cached.get("media_url") else None

    media_root = _media_root()
    if not media_root:
        return None

    result: dict[str, Any] | None = None
    kind_n = (kind or "").casefold()

    if module == "series":
        if kind_n in {"show", "series"}:
            result = _resolve_series_leaf(
                db,
                media_root,
                franchise_id=franchise_id,
                subseries_id=subseries_id,
                folder_path=folder_path,
            )
        elif kind_n == "franchise":
            chain = _series_folder_chain(
                media_root,
                franchise_id=franchise_id,
                subseries_id=None,
                folder_path=folder_path,
            )
            # Include all subseries folders
            folders = list(chain)
            if chain:
                from app.series_index import _list_subseries

                for s in _list_subseries(chain[-1][0], media_root):
                    fp = (s.get("folder_path") or "").replace("\\", "/")
                    if not fp:
                        continue
                    sp = media_root / Path(fp.replace("/", "\\"))
                    if sp.is_dir():
                        folders.append((sp, s.get("title") or sp.name))
            result = _resolve_series_scope(db, media_root, folders)
        elif kind_n in {"genre", "country", "universe"}:
            # Sample from catalog leaves matching filter — keep light
            from app.series_index import build_series_catalog
            from app.module_catalog_cache import get_or_build_catalog

            catalog = get_or_build_catalog(
                "series",
                media_root=media_root,
                builder=lambda: build_series_catalog(media_root),
            )
            folders: list[tuple[Path, str | None]] = []
            for fr in (catalog.get("franchises") or [])[:80]:
                if kind_n == "universe":
                    uids = fr.get("universe_ids") or fr.get("universes") or []
                    if universe_id and universe_id not in {
                        str(u) for u in (uids if isinstance(uids, list) else [])
                    }:
                        # Also check single universe_id field
                        if str(fr.get("universe_id") or "") != str(universe_id):
                            continue
                if kind_n == "genre" and genre_id is not None:
                    gids = fr.get("genre_ids") or []
                    if genre_id not in gids and str(genre_id) not in {
                        str(g) for g in gids
                    }:
                        # Fall through: still allow subseries genre match later if needed
                        subs = fr.get("subseries") or []
                        if not any(
                            genre_id in (s.get("genre_ids") or [])
                            or str(genre_id)
                            in {str(g) for g in (s.get("genre_ids") or [])}
                            for s in subs
                        ):
                            continue
                if kind_n == "country":
                    iso = (fr.get("country_iso") or fr.get("iso") or "").casefold()
                    cname = (fr.get("country") or "").casefold()
                    want = (country_name or "").casefold()
                    if country_id is not None and fr.get("country_id") not in {
                        country_id,
                        str(country_id),
                    }:
                        if want and want not in {cname, iso}:
                            continue
                    elif want and want not in {cname, iso}:
                        continue
                fp = (fr.get("folder_path") or "").replace("\\", "/")
                if fp:
                    p = media_root / Path(fp.replace("/", "\\"))
                    if p.is_dir():
                        folders.append((p, fr.get("name") or p.name))
                for s in fr.get("subseries") or []:
                    sp = (s.get("folder_path") or "").replace("\\", "/")
                    if not sp:
                        continue
                    p = media_root / Path(sp.replace("/", "\\"))
                    if p.is_dir():
                        folders.append((p, s.get("title") or p.name))
                if len(folders) >= 24:
                    break
            result = _resolve_series_scope(db, media_root, folders)

    elif module == "movies":
        if kind_n in {"film", "movie"}:
            result = _resolve_movie_leaf(
                db, media_root, film_id=film_id, folder_path=folder_path
            )
        elif kind_n == "franchise":
            from app.movies_index import find_work_dir, _iter_work_leaf_items

            folders: list[tuple[Path, str | None]] = []
            if folder_path:
                p = media_root / Path(folder_path.replace("/", "\\"))
                if p.is_dir():
                    folders.append((p, p.name))
            if franchise_id:
                found = find_work_dir(franchise_id, media_root)
                if found:
                    work_dir, _letter = found
                    folders.append((work_dir, work_dir.name))
                    for item_dir, _d, title, _h in _iter_work_leaf_items(work_dir):
                        folders.append((item_dir, title or item_dir.name))
            # Movies franchise: trailer → other extras → film file → audio
            random.shuffle(folders)
            for folder, title in folders[:16]:
                hit = _extras_preview(
                    folder, media_root, prefer_opening=False, series_title=title
                )
                if hit:
                    result = hit
                    break
            if result is None:
                for folder, title in folders[:16]:
                    vids = _list_videos(folder)
                    if vids:
                        result = _video_preview(
                            vids[0], media_root, series_title=title
                        )
                        break
            if result is None:
                for folder, title in folders[:8]:
                    hit = _audio_from_folder(
                        db, folder, media_root, series_title=title
                    )
                    if hit:
                        result = hit
                        break
        elif kind_n in {"genre", "country", "universe"}:
            from app.movies_index import build_movies_catalog
            from app.module_catalog_cache import get_or_build_catalog

            catalog = get_or_build_catalog(
                "movies",
                media_root=media_root,
                builder=lambda: build_movies_catalog(media_root),
            )
            folders = []
            for film in (catalog.get("films") or [])[:100]:
                if kind_n == "universe":
                    if universe_id and str(film.get("universe_id") or "") != str(
                        universe_id
                    ):
                        uids = film.get("universe_ids") or []
                        if str(universe_id) not in {str(u) for u in uids}:
                            continue
                if kind_n == "genre" and genre_id is not None:
                    gids = film.get("genre_ids") or []
                    if genre_id not in gids and str(genre_id) not in {
                        str(g) for g in gids
                    }:
                        continue
                if kind_n == "country":
                    iso = (film.get("country_iso") or film.get("iso") or "").casefold()
                    cname = (film.get("country") or "").casefold()
                    want = (country_name or "").casefold()
                    if want and want not in {cname, iso}:
                        if country_id is not None and film.get("country_id") not in {
                            country_id,
                            str(country_id),
                        }:
                            continue
                        if country_id is None:
                            continue
                fp = (film.get("folder_path") or "").replace("\\", "/")
                if not fp:
                    continue
                p = media_root / Path(fp.replace("/", "\\"))
                if p.is_dir():
                    folders.append((p, film.get("name") or film.get("title") or p.name))
                if len(folders) >= 24:
                    break
            random.shuffle(folders)
            for folder, title in folders[:12]:
                hit = _extras_preview(
                    folder, media_root, prefer_opening=False, series_title=title
                )
                if hit:
                    result = hit
                    break
            if result is None:
                for folder, title in folders[:12]:
                    vids = _list_videos(folder)
                    if vids:
                        result = _video_preview(
                            random.choice(vids), media_root, series_title=title
                        )
                        break
            if result is None:
                for folder, title in folders[:8]:
                    hit = _audio_from_folder(
                        db, folder, media_root, series_title=title
                    )
                    if hit:
                        result = hit
                        break

    if result:
        _cache_set(cache_key, result)
    else:
        _cache_set(cache_key, {})
    return result
