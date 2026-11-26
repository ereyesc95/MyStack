"""Lightweight dash-card preview candidates for Series / Movies (and later Games/Books)."""
from __future__ import annotations

import random
import re
import time
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.band_library import artwork_role_urls_for_track_path
from app.config import settings
from app.media_item_overview import VIDEO_EXTS
from app.media_paths_util import safe_relative
from app.series_paths import find_audio_bucket, find_episodes_root, find_extras_dir

PreviewModule = Literal["series", "movies", "books", "games"]
PreviewKind = Literal[
    "show",
    "franchise",
    "universe",
    "genre",
    "country",
    "film",
    "book",
    "game",
]


def _genre_matches(
    card: dict[str, Any],
    *,
    genre_id: int | None,
    genre_name_by_id: dict[int, str] | None = None,
) -> bool:
    """Match genre_ids, or genre_names when ids were never stamped."""
    if genre_id is None:
        return True
    gids = card.get("genre_ids") or []
    if genre_id in gids or str(genre_id) in {str(g) for g in gids}:
        return True
    want = ""
    if genre_name_by_id:
        want = (genre_name_by_id.get(genre_id) or "").casefold()
    if not want:
        return False
    names = {
        str(n).casefold()
        for n in (card.get("genre_names") or [])
        if n
    }
    return want in names


def _subgenre_name_map(db: Session) -> dict[int, str]:
    from sqlalchemy import select

    from app.models import Subgenre

    out: dict[int, str] = {}
    for row in db.scalars(select(Subgenre)).all():
        if row.sgn_id is None:
            continue
        name = (row.sgn_name or "").strip()
        if name:
            out[int(row.sgn_id)] = name
    return out


def _country_matches(
    card: dict[str, Any],
    *,
    country_id: int | None,
    country_name: str | None,
    country_iso: str | None,
) -> bool:
    """Match catalog cards by id, ISO code, or country name (name alone ≠ ISO)."""
    iso = (card.get("country_iso") or card.get("iso") or "").casefold()[:2]
    extra_isos = {
        str(x).casefold()[:2]
        for x in (card.get("country_isos") or [])
        if x
    }
    cname = (
        card.get("country") or card.get("country_name") or ""
    ).casefold()
    want_iso = (country_iso or "").casefold()[:2]
    want_name = (country_name or "").casefold()
    cid = card.get("country_id")
    if country_id is not None and cid in {country_id, str(country_id)}:
        return True
    if want_iso and (iso == want_iso or want_iso in extra_isos):
        return True
    if want_name and want_name in {cname, iso}:
        return True
    return False


def _universe_member_folders(
    db: Session,
    *,
    module: PreviewModule,
    media_root: Path,
    universe_id: str | None,
    catalog: dict[str, Any],
) -> list[tuple[Path, str | None]]:
    """Resolve folder paths for franchises/leaves belonging to a universe."""
    if not universe_id:
        return []
    try:
        uid = int(universe_id)
    except (TypeError, ValueError):
        return []

    from sqlalchemy import select

    from app.franchise_index import normalize_franchise_slug
    from app.models import UniverseFranchiseSync, UniverseMember

    folders: list[tuple[Path, str | None]] = []
    seen: set[str] = set()

    def _add(rel: str | None, title: str | None) -> None:
        if not rel:
            return
        key = rel.replace("\\", "/").casefold()
        if key in seen:
            return
        p = media_root / Path(rel.replace("/", "\\"))
        if not p.is_dir():
            return
        seen.add(key)
        folders.append((p, title or p.name))

    member_slugs: set[str] = set()
    for row in db.scalars(
        select(UniverseMember).where(
            UniverseMember.ume_universe_id == uid,
            UniverseMember.ume_module == module,
        )
    ).all():
        slug = (row.ume_slug or "").strip()
        if slug:
            member_slugs.add(normalize_franchise_slug(slug) or slug.casefold())
            member_slugs.add(slug.casefold())

    for row in db.scalars(
        select(UniverseFranchiseSync).where(
            UniverseFranchiseSync.ufs_universe_id == uid,
            UniverseFranchiseSync.ufs_module == module,
        )
    ).all():
        slug = (row.ufs_franchise_slug or "").strip()
        if slug:
            member_slugs.add(normalize_franchise_slug(slug) or slug.casefold())
            member_slugs.add(slug.casefold())

    if not member_slugs:
        return folders

    for fr in catalog.get("franchises") or []:
        if not isinstance(fr, dict):
            continue
        fid = str(fr.get("id") or "").strip()
        name = str(fr.get("name") or "").strip()
        keys = {
            fid.casefold(),
            name.casefold(),
            (normalize_franchise_slug(name) or "").casefold(),
            (normalize_franchise_slug(fid) or "").casefold(),
        }
        keys.discard("")
        if not (keys & member_slugs):
            continue
        _add(fr.get("folder_path"), fr.get("name"))
        for leaf in (
            fr.get("subseries")
            or fr.get("games")
            or fr.get("books")
            or fr.get("films")
            or []
        ):
            if not isinstance(leaf, dict):
                continue
            _add(
                leaf.get("folder_path"),
                leaf.get("title") or leaf.get("name"),
            )
        if len(folders) >= 24:
            break

    # Movies often list films at top level (no franchise wrap for every title)
    for film in catalog.get("films") or []:
        if not isinstance(film, dict):
            continue
        fid = str(film.get("id") or film.get("work_id") or "").strip()
        name = str(film.get("name") or film.get("title") or "").strip()
        keys = {
            fid.casefold(),
            name.casefold(),
            (normalize_franchise_slug(name) or "").casefold(),
            (normalize_franchise_slug(fid) or "").casefold(),
        }
        keys.discard("")
        if not (keys & member_slugs):
            continue
        _add(
            film.get("folder_path"),
            film.get("name") or film.get("title"),
        )
        if len(folders) >= 24:
            break

    return folders


def _enriched_module_catalog(
    db: Session, module: PreviewModule, media_root: Path
) -> dict[str, Any]:
    """FS catalog + live DB enrich (country/genre) — skip listing enrich cache.

    Dash vibes/origins need current enrich fields; the NSFW listing cache can
    lag behind enrich schema changes and omit genre_ids / country_iso.
    """
    from app.module_catalog_cache import get_or_build_catalog

    if module == "series":
        from app.series_index import build_series_catalog
        from app.series_catalog_meta import enrich_catalog_metadata

        raw = get_or_build_catalog(
            "series",
            media_root=media_root,
            builder=lambda: build_series_catalog(media_root),
        )
        return enrich_catalog_metadata(db, raw)

    if module == "movies":
        from app.movies_index import build_movies_catalog
        from app.movies_catalog_meta import enrich_movies_catalog

        raw = get_or_build_catalog(
            "movies",
            media_root=media_root,
            builder=lambda: build_movies_catalog(media_root),
        )
        return enrich_movies_catalog(db, raw)

    if module == "books":
        from app.books_index import build_books_catalog
        from app.books_catalog_meta import enrich_books_catalog

        raw = get_or_build_catalog(
            "books",
            media_root=media_root,
            builder=lambda: build_books_catalog(media_root),
        )
        return enrich_books_catalog(db, raw)

    from app.games_index import build_games_catalog
    from app.games_catalog_meta import enrich_games_catalog

    raw = get_or_build_catalog(
        "games",
        media_root=media_root,
        builder=lambda: build_games_catalog(media_root),
    )
    return enrich_games_catalog(db, raw)


def _folder_video_or_audio_preview(
    db: Session,
    media_root: Path,
    folders: list[tuple[Path, str | None]],
    *,
    prefer_opening: bool = False,
) -> dict[str, Any] | None:
    if not folders:
        return None
    sample = list(folders)
    random.shuffle(sample)
    for folder, title in sample[:16]:
        hit = _extras_preview(
            folder, media_root, prefer_opening=prefer_opening, series_title=title
        )
        if hit:
            return hit
    for folder, title in sample[:16]:
        vids = _list_videos(folder)
        if vids:
            return _video_preview(
                random.choice(vids), media_root, series_title=title
            )
    for folder, title in sample[:8]:
        hit = _audio_from_folder(db, folder, media_root, series_title=title)
        if hit:
            return hit
    return None

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


_DATE_FOLDER_PREFIX_RE = re.compile(r"^\d{4}(?:\.\d{1,2}){0,2}\.\s*")


def _strip_brackets(title: str) -> str:
    return re.sub(r"\s*\[[^\]]*\]", "", title or "").strip()


def _display_media_title(path: Path, title: str | None = None) -> str:
    """Human title for dash previews — strip full ``YYYY.MM.DD.`` before track #.

    ``display_track_title_from_path`` treats ``2002.`` as a track index and leaves
    ``02.14. Live at Hell``; strip the dated-folder prefix first.
    """
    raw = (title or path.stem or "").strip()
    raw = _DATE_FOLDER_PREFIX_RE.sub("", raw).strip() or (path.stem or "")
    # Only apply track-number strip when it still looks like ``NN. Title``
    if re.match(r"^\d{1,3}\.\s+\S", raw):
        raw = re.sub(r"^\d{1,3}\.\s+", "", raw).strip() or raw
    return _strip_brackets(raw)


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
    display = _display_media_title(path, title)
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
        "title": _display_media_title(path, title),
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
    country_iso: str | None = None,
    universe_id: str | None = None,
) -> dict[str, Any] | None:
    # v2: enriched catalog (country_iso / genre_ids) — bust empty negatives from v1
    cache_key = "|".join(
        [
            "v2",
            module,
            kind,
            franchise_id or "",
            subseries_id or "",
            film_id or "",
            folder_path or "",
            str(genre_id or ""),
            str(country_id or ""),
            country_name or "",
            country_iso or "",
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
    genre_name_by_id: dict[int, str] | None = None
    if kind_n == "genre" and genre_id is not None:
        genre_name_by_id = _subgenre_name_map(db)

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
            # Enriched catalog carries country_iso / genre_ids from Series rows.
            catalog = _enriched_module_catalog(db, "series", media_root)
            folders: list[tuple[Path, str | None]] = []
            if kind_n == "universe":
                folders = _universe_member_folders(
                    db,
                    module="series",
                    media_root=media_root,
                    universe_id=universe_id,
                    catalog=catalog,
                )
                result = _resolve_series_scope(db, media_root, folders)
            for fr in catalog.get("franchises") or []:
                if kind_n == "universe":
                    break
                if not isinstance(fr, dict):
                    continue
                if kind_n == "genre" and genre_id is not None:
                    if not _genre_matches(
                        fr, genre_id=genre_id, genre_name_by_id=genre_name_by_id
                    ):
                        subs = fr.get("subseries") or []
                        if not any(
                            _genre_matches(
                                s,
                                genre_id=genre_id,
                                genre_name_by_id=genre_name_by_id,
                            )
                            for s in subs
                            if isinstance(s, dict)
                        ):
                            continue
                if kind_n == "country" and not _country_matches(
                    fr,
                    country_id=country_id,
                    country_name=country_name,
                    country_iso=country_iso,
                ):
                    continue
                fp = (fr.get("folder_path") or "").replace("\\", "/")
                if fp:
                    p = media_root / Path(fp.replace("/", "\\"))
                    if p.is_dir():
                        folders.append((p, fr.get("name") or p.name))
                for s in fr.get("subseries") or []:
                    if not isinstance(s, dict):
                        continue
                    sp = (s.get("folder_path") or "").replace("\\", "/")
                    if not sp:
                        continue
                    p = media_root / Path(sp.replace("/", "\\"))
                    if p.is_dir():
                        folders.append((p, s.get("title") or p.name))
                if len(folders) >= 24:
                    break
            if kind_n != "universe":
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
            catalog = _enriched_module_catalog(db, "movies", media_root)
            folders = []
            if kind_n == "universe":
                folders = _universe_member_folders(
                    db,
                    module="movies",
                    media_root=media_root,
                    universe_id=universe_id,
                    catalog=catalog,
                )
                result = _folder_video_or_audio_preview(db, media_root, folders)
            for film in catalog.get("films") or []:
                if kind_n == "universe":
                    break
                if not isinstance(film, dict):
                    continue
                if kind_n == "genre" and not _genre_matches(
                    film, genre_id=genre_id, genre_name_by_id=genre_name_by_id
                ):
                    continue
                if kind_n == "country" and not _country_matches(
                    film,
                    country_id=country_id,
                    country_name=country_name,
                    country_iso=country_iso,
                ):
                    continue
                fp = (film.get("folder_path") or "").replace("\\", "/")
                if not fp:
                    continue
                p = media_root / Path(fp.replace("/", "\\"))
                if p.is_dir():
                    folders.append((p, film.get("name") or film.get("title") or p.name))
                if len(folders) >= 24:
                    break
            if kind_n != "universe":
                result = _folder_video_or_audio_preview(db, media_root, folders)

    elif module in {"books", "games"}:
        catalog = _enriched_module_catalog(db, module, media_root)
        folders: list[tuple[Path, str | None]] = []

        def _append_path(rel: str | None, title: str | None) -> None:
            if not rel:
                return
            fp = rel.replace("\\", "/")
            p = media_root / Path(fp.replace("/", "\\"))
            if p.is_dir():
                folders.append((p, title or p.name))

        if kind_n in {"franchise", "show", "book", "game", "film"}:
            if folder_path:
                _append_path(folder_path, None)
            if franchise_id:
                for fr in catalog.get("franchises") or []:
                    if str(fr.get("id") or "") != str(franchise_id):
                        continue
                    _append_path(fr.get("folder_path"), fr.get("name"))
                    for leaf in fr.get("games") or fr.get("books") or fr.get("films") or []:
                        _append_path(
                            leaf.get("folder_path"),
                            leaf.get("title") or leaf.get("name"),
                        )
                    break
            if film_id:
                for leaf in (
                    catalog.get("games")
                    or catalog.get("books")
                    or catalog.get("films")
                    or []
                ):
                    if str(leaf.get("id") or "") != str(film_id):
                        continue
                    _append_path(
                        leaf.get("folder_path"),
                        leaf.get("title") or leaf.get("name"),
                    )
                    break
            result = _folder_video_or_audio_preview(
                db, media_root, folders, prefer_opening=module == "games"
            )
        elif kind_n in {"genre", "country", "universe"}:
            if kind_n == "universe":
                folders = _universe_member_folders(
                    db,
                    module=module,
                    media_root=media_root,
                    universe_id=universe_id,
                    catalog=catalog,
                )
                result = _folder_video_or_audio_preview(
                    db, media_root, folders, prefer_opening=module == "games"
                )
            for fr in catalog.get("franchises") or []:
                if kind_n == "universe":
                    break
                if not isinstance(fr, dict):
                    continue
                if kind_n == "genre" and genre_id is not None:
                    if not _genre_matches(
                        fr, genre_id=genre_id, genre_name_by_id=genre_name_by_id
                    ):
                        leaves = (
                            fr.get("games")
                            or fr.get("books")
                            or fr.get("films")
                            or []
                        )
                        if not any(
                            _genre_matches(
                                leaf,
                                genre_id=genre_id,
                                genre_name_by_id=genre_name_by_id,
                            )
                            for leaf in leaves
                            if isinstance(leaf, dict)
                        ):
                            continue
                if kind_n == "country" and not _country_matches(
                    fr,
                    country_id=country_id,
                    country_name=country_name,
                    country_iso=country_iso,
                ):
                    # Also try leaf cards
                    leaves = (
                        fr.get("games")
                        or fr.get("books")
                        or fr.get("films")
                        or []
                    )
                    if not any(
                        _country_matches(
                            leaf,
                            country_id=country_id,
                            country_name=country_name,
                            country_iso=country_iso,
                        )
                        for leaf in leaves
                        if isinstance(leaf, dict)
                    ):
                        continue
                _append_path(fr.get("folder_path"), fr.get("name"))
                for leaf in (
                    fr.get("games") or fr.get("books") or fr.get("films") or []
                ):
                    if not isinstance(leaf, dict):
                        continue
                    _append_path(
                        leaf.get("folder_path"),
                        leaf.get("title") or leaf.get("name"),
                    )
                if len(folders) >= 24:
                    break
            # Also scan flat leaf lists (games/books catalogs)
            if kind_n != "universe":
                for leaf in (
                    catalog.get("games")
                    or catalog.get("books")
                    or catalog.get("films")
                    or []
                ):
                    if not isinstance(leaf, dict):
                        continue
                    if kind_n == "country" and not _country_matches(
                        leaf,
                        country_id=country_id,
                        country_name=country_name,
                        country_iso=country_iso,
                    ):
                        continue
                    if kind_n == "genre" and not _genre_matches(
                        leaf,
                        genre_id=genre_id,
                        genre_name_by_id=genre_name_by_id,
                    ):
                        continue
                    _append_path(
                        leaf.get("folder_path"),
                        leaf.get("title") or leaf.get("name"),
                    )
                    if len(folders) >= 24:
                        break
                result = _folder_video_or_audio_preview(
                    db, media_root, folders, prefer_opening=module == "games"
                )

    # Cache hits only — empty misses must not stick after enrich/media fixes.
    if result:
        _cache_set(cache_key, result)
    return result
