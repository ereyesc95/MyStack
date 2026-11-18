"""Dated activity for Series/Movies/Books/Games/Files/Hobbies Wrapped."""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ModuleActivityDay
from app.profiles import ADMIN_USER_ID

MODULES = frozenset(
    {"series", "movies", "books", "games", "files", "hobbies", "photos"}
)

_MODULE_COPY: dict[str, dict[str, str]] = {
    "series": {
        "eyebrow": "Your year in shows",
        "count_label": "plays",
        "empty_hint": "Watch episodes from today onward — Wrapped fills in as you go.",
        "items_tab": "On repeat",
        "groups_tab": "Top shows",
        "franchises_tab": "Top franchises",
        "vibes_tab": "Vibes",
        "items_rank": "#1 On repeat",
        "groups_rank": "#1 Show",
        "franchises_rank": "#1 Franchise",
        "browse_label": "Browse top show",
    },
    "movies": {
        "eyebrow": "Your year in film",
        "count_label": "plays",
        "empty_hint": "Watch films from today onward — Wrapped fills in as you go.",
        "items_tab": "On repeat",
        "groups_tab": "Top franchises",
        "franchises_tab": "Top franchises",
        "vibes_tab": "Vibes",
        "items_rank": "#1 On repeat",
        "groups_rank": "#1 Franchise",
        "franchises_rank": "#1 Franchise",
        "browse_label": "Browse top franchise",
    },
    "books": {
        "eyebrow": "Your year in pages",
        "count_label": "reads",
        "empty_hint": "Open books from today onward — Wrapped fills in as you go.",
        "items_tab": "On repeat",
        "groups_tab": "Top franchises",
        "franchises_tab": "Top franchises",
        "vibes_tab": "Vibes",
        "items_rank": "#1 On repeat",
        "groups_rank": "#1 Franchise",
        "franchises_rank": "#1 Franchise",
        "browse_label": "Browse top franchise",
    },
    "games": {
        "eyebrow": "Your year in play",
        "count_label": "plays",
        "empty_hint": "Open games from today onward — Wrapped fills in as you go.",
        "items_tab": "On repeat",
        "groups_tab": "Top franchises",
        "franchises_tab": "Top franchises",
        "vibes_tab": "Platforms",
        "items_rank": "#1 On repeat",
        "groups_rank": "#1 Franchise",
        "franchises_rank": "#1 Franchise",
        "browse_label": "Browse top franchise",
    },
    "photos": {
        "eyebrow": "Your year in photos",
        "count_label": "views",
        "empty_hint": "Open photos from today onward — Wrapped fills in as you go.",
        "items_tab": "Top photos",
        "videos_tab": "Top videos",
        "groups_tab": "Top years",
        "vibes_tab": "Only once",
        "items_rank": "#1 Photo",
        "videos_rank": "#1 Video",
        "groups_rank": "#1 Year",
        "browse_label": "Browse top year",
    },
    "files": {
        "eyebrow": "Your year in files",
        "count_label": "opens",
        "empty_hint": "Open files from today onward — Wrapped fills in as you go.",
        "items_tab": "Most opened",
        "groups_tab": "Top folders",
        "vibes_tab": "Only once",
        "items_rank": "#1 File",
        "groups_rank": "#1 Folder",
        "browse_label": "Browse top folder",
    },
    "hobbies": {
        "eyebrow": "Your year in hobbies",
        "count_label": "opens",
        "empty_hint": "Open hobby items from today onward — Wrapped fills in as you go.",
        "items_tab": "Top opened",
        "groups_tab": "Top collections",
        "franchises_tab": "Top franchises",
        "vibes_tab": "Only once",
        "items_rank": "#1 Item",
        "groups_rank": "#1 Collection",
        "franchises_rank": "#1 Franchise",
        "browse_label": "Browse top collection",
    },
}


def _today_iso() -> str:
    return date.today().isoformat()


def _scoped_user_id(user_id: int) -> int:
    return ADMIN_USER_ID if user_id == ADMIN_USER_ID else user_id


def _norm_module(module: str) -> str:
    return (module or "").strip().casefold()


def record_module_activity(
    db: Session,
    *,
    user_id: int,
    module: str,
    entity_kind: str,
    entity_id: str,
    title: str | None = None,
    path: str | None = None,
    franchise_id: str | None = None,
    franchise_title: str | None = None,
    cover_url: str | None = None,
    group_id: str | None = None,
    group_title: str | None = None,
    vibe_key: str | None = None,
    vibe_label: str | None = None,
    activity_date: str | None = None,
) -> ModuleActivityDay | None:
    """Upsert one dated activity row for module Wrapped / streaks."""
    mod = _norm_module(module)
    if mod not in MODULES:
        return None
    eid = (entity_id or "").strip()
    kind = (entity_kind or "").strip().casefold() or "item"
    if not eid:
        return None
    day = (activity_date or _today_iso()).strip()[:10]
    if len(day) < 10:
        day = _today_iso()
    uid = _scoped_user_id(user_id)
    row = db.scalar(
        select(ModuleActivityDay).where(
            ModuleActivityDay.mad_user_id == uid,
            ModuleActivityDay.mad_date == day,
            ModuleActivityDay.mad_module == mod,
            ModuleActivityDay.mad_entity_kind == kind,
            ModuleActivityDay.mad_entity_id == eid,
        )
    )
    def _title_looks_raw(value: str | None) -> bool:
        t = (value or "").strip()
        if not t:
            return True
        low = t.casefold()
        if low == eid.casefold():
            return True
        if "/" in t or "\\" in t:
            return True
        if low.startswith(("book_", "game_", "ep_", "film_")):
            return True
        return False

    if row:
        row.mad_count = int(row.mad_count or 0) + 1
        if title and (_title_looks_raw(row.mad_title) or not row.mad_title):
            row.mad_title = title
        if path and not row.mad_path:
            row.mad_path = path
        if franchise_id and not row.mad_franchise_id:
            row.mad_franchise_id = franchise_id
        if franchise_title and (
            not row.mad_franchise_title
            or (row.mad_franchise_title or "").casefold()
            == (row.mad_franchise_id or "").casefold()
        ):
            row.mad_franchise_title = franchise_title
        if cover_url and not row.mad_cover_url:
            row.mad_cover_url = cover_url
        if group_id and not row.mad_group_id:
            row.mad_group_id = group_id
        if group_title and not row.mad_group_title:
            row.mad_group_title = group_title
        # Always refresh vibe when the client sends one — first play often
        # lands before leaf genres resolve, so a later play must be able to fill it.
        if vibe_key:
            row.mad_vibe_key = vibe_key
        if vibe_label:
            row.mad_vibe_label = vibe_label
        elif vibe_key and not row.mad_vibe_label:
            row.mad_vibe_label = vibe_key
    else:
        row = ModuleActivityDay(
            mad_user_id=uid,
            mad_date=day,
            mad_module=mod,
            mad_entity_kind=kind,
            mad_entity_id=eid,
            mad_path=(path or "").replace("\\", "/") or None,
            mad_title=title,
            mad_franchise_id=franchise_id,
            mad_franchise_title=franchise_title,
            mad_cover_url=cover_url,
            mad_group_id=group_id,
            mad_group_title=group_title,
            mad_vibe_key=vibe_key,
            mad_vibe_label=vibe_label,
            mad_count=1,
        )
        db.add(row)
    db.commit()
    return row


def _user_days(db: Session, user_id: int, module: str) -> list[date]:
    uid = _scoped_user_id(user_id)
    mod = _norm_module(module)
    rows = db.scalars(
        select(ModuleActivityDay.mad_date)
        .where(
            ModuleActivityDay.mad_user_id == uid,
            ModuleActivityDay.mad_module == mod,
        )
        .distinct()
        .order_by(ModuleActivityDay.mad_date.desc())
    ).all()
    out: list[date] = []
    for raw in rows:
        try:
            out.append(date.fromisoformat(str(raw)[:10]))
        except ValueError:
            continue
    return out


def _streak_from_days(
    days: list[date], *, today: date | None = None
) -> tuple[int, int]:
    if not days:
        return 0, 0
    uniq = sorted(set(days), reverse=True)
    longest = 1
    run = 1
    for i in range(1, len(uniq)):
        if uniq[i - 1] - uniq[i] == timedelta(days=1):
            run += 1
            longest = max(longest, run)
        else:
            run = 1
    longest = max(longest, run)

    anchor = today or date.today()
    if uniq[0] not in (anchor, anchor - timedelta(days=1)):
        return 0, longest
    current = 1
    expect = uniq[0] - timedelta(days=1)
    for d in uniq[1:]:
        if d == expect:
            current += 1
            expect = d - timedelta(days=1)
        else:
            break
    return current, longest


def _year_rows(
    db: Session, user_id: int, module: str, year: int
) -> list[ModuleActivityDay]:
    uid = _scoped_user_id(user_id)
    mod = _norm_module(module)
    start = f"{year:04d}-01-01"
    end = f"{year:04d}-12-31"
    return list(
        db.scalars(
            select(ModuleActivityDay).where(
                ModuleActivityDay.mad_user_id == uid,
                ModuleActivityDay.mad_module == mod,
                ModuleActivityDay.mad_date >= start,
                ModuleActivityDay.mad_date <= end,
            )
        ).all()
    )


def _item_row(
    *,
    id: str,
    title: str,
    play_count: int,
    cover_url: str | None = None,
    subtitle: str | None = None,
    franchise_id: str | None = None,
    entity_kind: str | None = None,
    path: str | None = None,
    group_id: str | None = None,
    vibe_key: str | None = None,
    image_url: str | None = None,
    leaf_id: str | None = None,
) -> dict[str, Any]:
    return {
        "id": id,
        "title": title,
        "name": title,
        "play_count": play_count,
        "cover_url": cover_url,
        "photo_url": cover_url,
        "image_url": image_url or cover_url,
        "subtitle": subtitle,
        "franchise_id": franchise_id,
        "entity_kind": entity_kind,
        "path": path,
        "group_id": group_id,
        "leaf_id": leaf_id or group_id,
        "vibe_key": vibe_key,
    }


def _display_title_from_path(path: str | None) -> str | None:
    """Human title from a media-relative path (never return the raw path)."""
    from pathlib import PurePosixPath

    rel = (path or "").replace("\\", "/").strip("/")
    if not rel:
        return None
    name = PurePosixPath(rel).name
    if "." in name and name.rsplit(".", 1)[-1].casefold() in {
        "mp4",
        "mkv",
        "avi",
        "m4v",
        "webm",
        "mov",
    }:
        name = PurePosixPath(rel).stem
    # Dated folder / file: ``YYYY.MM.DD. Title`` or ``YYYY. Title``
    import re

    m = re.match(r"^\d{4}(?:\.\d{2}(?:\.\d{2})?)?\.\s*(.+)$", name.strip())
    if m:
        return m.group(1).strip() or None
    return name.strip() or None


def _strip_dated_folder_label(name: str | None) -> str | None:
    """``2015.07.05. Dragon Ball Super`` → ``Dragon Ball Super``."""
    text = (name or "").strip()
    if not text:
        return None
    import re

    m = re.match(r"^\d{4}(?:\.\d{2}(?:\.\d{2})?)?\.\s*(.+)$", text)
    if m:
        return m.group(1).strip() or text
    return text


def _pretty_franchise_name(value: str | None) -> str | None:
    text = (value or "").strip()
    if not text:
        return None
    text = _strip_dated_folder_label(text) or text
    # Slug-like → title case words
    if text == text.casefold() and (" " in text or "-" in text or "_" in text):
        parts = text.replace("-", " ").replace("_", " ").split()
        return " ".join(p[:1].upper() + p[1:] if p else "" for p in parts)
    return text


def _enrich_media_item(
    db: Session,
    module: str,
    row: dict[str, Any],
) -> dict[str, Any]:
    """Fill missing titles / covers / franchise labels from catalog when possible."""
    mod = module.casefold()
    title = (row.get("title") or "").strip()
    path = (row.get("path") or "").strip()
    eid = (row.get("id") or "").strip()
    kind = (row.get("entity_kind") or "").casefold()

    if not title or title == eid or "/" in title or "\\" in title:
        from_path = _display_title_from_path(path or eid if "/" in eid else path)
        if from_path:
            row["title"] = from_path
            row["name"] = from_path
            title = from_path

    fid = (row.get("franchise_id") or "").strip()
    ftitle = _pretty_franchise_name(row.get("subtitle") or row.get("franchise_title"))
    if ftitle:
        row["subtitle"] = ftitle

    # Catalog lookups for leaf covers / titles
    try:
        if mod == "movies" and (kind in {"film", ""} or eid):
            from pathlib import PurePosixPath

            from app.movies_index import _film_id, build_film_detail

            detail = None
            look = eid if eid.startswith("film_") else None
            if not look and (path or eid.startswith("Movies/")):
                media_rel = (path or eid).replace("\\", "/").strip("/")
                parent = PurePosixPath(media_rel).parent.as_posix()
                if parent and parent.lower().startswith("movies/"):
                    look = _film_id(parent)
            if look:
                try:
                    detail = build_film_detail(look)
                except Exception:
                    detail = None
            if not detail and (path or "/" in eid):
                from_path = _display_title_from_path(path or eid)
                if from_path:
                    row["title"] = from_path
                    row["name"] = from_path
            if detail:
                if detail.get("title"):
                    row["title"] = detail["title"]
                    row["name"] = detail["title"]
                cover = (
                    detail.get("portrait_url")
                    or detail.get("cover_url")
                    or detail.get("banner_url")
                )
                if cover:
                    row["cover_url"] = cover
                    row["photo_url"] = cover
                wid = detail.get("work_id") or detail.get("work_name")
                wname = detail.get("work_name")
                if wid:
                    row["franchise_id"] = wid
                if wname:
                    row["subtitle"] = wname
                if detail.get("id"):
                    row["leaf_id"] = detail["id"]
                    row["id"] = detail["id"]
        elif mod in {"books", "games"}:
            # Prefer catalog-cache card (fast) before full detail build.
            detail = None
            try:
                from app.module_catalog_cache import peek_catalog_payload
                from app.config import settings
                from pathlib import Path

                root = Path(settings.media_root) if settings.media_root else None
                payload = (
                    peek_catalog_payload(mod, media_root=root) if root else None
                ) or {}
                key = "books" if mod == "books" else "games"
                for card in payload.get(key) or payload.get("films") or []:
                    if isinstance(card, dict) and card.get("id") == eid:
                        detail = card
                        break
            except Exception:
                detail = None
            if not detail:
                if mod == "books" and eid.startswith("book_"):
                    from app.books_index import build_book_detail as build_leaf

                    detail = build_leaf(eid)
                elif mod == "games" and eid.startswith("game_"):
                    from app.games_index import build_game_detail as build_leaf

                    detail = build_leaf(eid)
            if detail:
                if detail.get("title"):
                    row["title"] = detail["title"]
                    row["name"] = detail["title"]
                cover = (
                    detail.get("portrait_url")
                    or detail.get("cover_url")
                    or detail.get("banner_url")
                )
                if cover:
                    row["cover_url"] = cover
                    row["photo_url"] = cover
                wid = detail.get("work_id") or detail.get("franchise_id")
                wname = detail.get("work_name") or detail.get("franchise_name")
                if wid:
                    row["franchise_id"] = wid
                if wname:
                    row["subtitle"] = wname
        elif mod == "series":
            from pathlib import Path, PurePosixPath

            from app.config import settings
            from app.series_index import _series_folder_cover, find_franchise_dir

            root = Path(settings.media_root) if settings.media_root else None
            media_rel = (path or "").replace("\\", "/").strip("/")
            leaf_id = (row.get("leaf_id") or row.get("group_id") or "").strip()
            # Infer leaf (subseries folder name) from episode path:
            # Series/{Letter}/{Franchise}/{Leaf}/…
            if not leaf_id and media_rel.lower().startswith("series/"):
                parts = PurePosixPath(media_rel).parts
                if len(parts) >= 4:
                    leaf_id = parts[3]
                    row["leaf_id"] = leaf_id
                    row["group_id"] = leaf_id
            if not fid and media_rel.lower().startswith("series/"):
                parts = PurePosixPath(media_rel).parts
                if len(parts) >= 3:
                    fid = parts[2]
                    row["franchise_id"] = fid
            if fid and root:
                found = find_franchise_dir(fid, root)
                if found:
                    fdir, _letter = found
                    row["franchise_id"] = _normalize_slugish(fdir.name) or fid
                    # Subtitle = series/leaf name when known (not the franchise hub).
                    leaf_label = None
                    if leaf_id:
                        want = leaf_id.casefold()
                        try:
                            for child in fdir.iterdir():
                                if (
                                    child.is_dir()
                                    and not child.name.startswith(".")
                                    and child.name.casefold() == want
                                ):
                                    leaf_label = child.name
                                    break
                        except OSError:
                            leaf_label = None
                        if leaf_label is None:
                            direct = fdir / leaf_id
                            if direct.is_dir():
                                leaf_label = direct.name
                    existing_sub = (row.get("subtitle") or "").strip()
                    franchise_names = {
                        (fdir.name or "").casefold(),
                        (fid or "").casefold(),
                        (_normalize_slugish(fdir.name) or "").casefold(),
                    }
                    if leaf_label:
                        leaf_display = (
                            _strip_dated_folder_label(leaf_label) or leaf_label
                        )
                        if not existing_sub or existing_sub.casefold() in franchise_names:
                            row["subtitle"] = leaf_display
                        if not row.get("group_id"):
                            row["group_id"] = leaf_id
                        if not row.get("leaf_id"):
                            row["leaf_id"] = leaf_id
                    elif not existing_sub:
                        row["subtitle"] = fdir.name
                    # Cover: season (file parent chain) → leaf → franchise
                    if not row.get("cover_url") and media_rel:
                        file_parent = root / PurePosixPath(media_rel).parent
                        candidates: list[Path] = []
                        cur = file_parent
                        try:
                            while cur != fdir and fdir in cur.parents:
                                candidates.append(cur)
                                cur = cur.parent
                        except Exception:
                            candidates = [file_parent]
                        if leaf_id:
                            leaf_dir = fdir / leaf_id
                            if leaf_dir.is_dir():
                                candidates.append(leaf_dir)
                        candidates.append(fdir)
                        for cand in candidates:
                            art = _series_folder_cover(cand, root)
                            if art:
                                row["cover_url"] = art
                                row["photo_url"] = art
                                break
                    elif not row.get("cover_url"):
                        leaf_dir = (fdir / leaf_id) if leaf_id else None
                        if leaf_dir and leaf_dir.is_dir():
                            row["cover_url"] = _series_folder_cover(leaf_dir, root)
                        if not row.get("cover_url"):
                            row["cover_url"] = _series_folder_cover(fdir, root)
                        if row.get("cover_url"):
                            row["photo_url"] = row["cover_url"]
    except Exception:
        pass

    if row.get("subtitle"):
        row["subtitle"] = _pretty_franchise_name(row["subtitle"]) or row["subtitle"]
    return row


def _normalize_slugish(name: str | None) -> str | None:
    text = (name or "").strip()
    if not text:
        return None
    try:
        from app.franchise_index import normalize_franchise_slug

        return normalize_franchise_slug(text) or text
    except Exception:
        return text


def _module_top_tracks(
    db: Session, user_id: int, module: str, year: int
) -> list[dict[str, Any]]:
    """Music listening plays whose files live under releases linked from the module."""
    from pathlib import Path

    from app.config import settings
    from app.listening import path_play_counts_for_year
    from app.media_paths_util import resolve_media_entry, safe_relative
    from app.module_home_audio import _cached_audio_owners, _leaf_meta_by_folder
    from app.series_extras import AUDIO_CATEGORIES, _iter_category_release_entries, _resolve_child_dir
    from app.series_paths import find_audio_bucket
    from app.band_library import cover_url_for_track_path
    from app.music_dashboard import _clean_track_title
    from app.playlist_tracks import enrich_playlist_tracks

    root = Path(settings.media_root) if settings.media_root else None
    if not root or not root.is_dir():
        return []
    owners = _cached_audio_owners(module, db, nsfw_unlocked=True)
    leaf_meta = _leaf_meta_by_folder(module, db, nsfw_unlocked=True)
    # release_root → franchise/leaf display title
    release_source: dict[Path, str] = {}
    release_roots: list[Path] = []
    for folder in owners:
        bucket = find_audio_bucket(folder)
        if not bucket:
            continue
        owner_rel = (safe_relative(folder, root) or "").replace("\\", "/").strip("/")
        src_candidates: list[str] = []
        if owner_rel:
            meta = leaf_meta.get(owner_rel.casefold())
            if meta:
                for key in ("source_title", "source_franchise_id"):
                    val = (meta.get(key) or "").strip()
                    if val and val not in src_candidates:
                        src_candidates.append(val)
        if folder.name and folder.name not in src_candidates:
            src_candidates.append(folder.name)
        # Prefer the candidate that best matches the release folder name.
        def _pick_source(release_name: str, fallback: str | None) -> str | None:
            rel_cf = release_name.casefold()
            best: str | None = None
            best_score = -1
            for cand in src_candidates:
                c = cand.casefold()
                score = 0
                if c == rel_cf:
                    score = 1000
                elif c in rel_cf or rel_cf in c:
                    score = 100 + len(c)
                else:
                    score = 1
                if score > best_score:
                    best_score = score
                    best = cand
            if best_score >= 100:
                return best
            return fallback or (src_candidates[0] if src_candidates else None)

        for _key, cat_name in AUDIO_CATEGORIES.items():
            cat_dir = _resolve_child_dir(bucket, cat_name)
            if not cat_dir.is_dir():
                continue
            for entry in _iter_category_release_entries(cat_dir):
                resolved = resolve_media_entry(entry, media_root=root)
                if resolved and resolved.is_dir():
                    release_roots.append(resolved)
                    key = resolved.resolve()
                    picked = _pick_source(
                        resolved.name, src_candidates[0] if src_candidates else None
                    )
                    prev = release_source.get(key)
                    if prev is None:
                        release_source[key] = picked
                    elif picked:
                        # Upgrade when the new pick matches the release better.
                        rel_cf = resolved.name.casefold()
                        prev_cf = (prev or "").casefold()
                        pick_cf = picked.casefold()
                        prev_hit = prev_cf in rel_cf or rel_cf in prev_cf
                        pick_hit = pick_cf in rel_cf or rel_cf in pick_cf
                        if pick_hit and not prev_hit:
                            release_source[key] = picked
                        elif pick_hit and prev_hit and len(picked) > len(prev or ""):
                            release_source[key] = picked
    if not release_roots:
        return []

    counts = path_play_counts_for_year(db, user_id, year)
    if not counts:
        return []

    # Map each listening path → deepest owning release root (avoid false parents).
    release_cf = [(p.resolve(), p) for p in release_roots]
    release_cf.sort(key=lambda pair: len(pair[0].parts), reverse=True)
    scored: list[tuple[int, str, Path]] = []
    for rel, count in counts.items():
        if count <= 0:
            continue
        full = (root / rel.replace("\\", "/")).resolve()
        best: Path | None = None
        for r_resolved, r_path in release_cf:
            try:
                full.relative_to(r_resolved)
            except ValueError:
                continue
            best = r_path
            break
        if best is not None:
            scored.append((count, rel, best))
    scored.sort(key=lambda t: (-t[0], t[1].casefold()))
    raw_tracks: list[dict[str, Any]] = []
    for i, (count, rel, r_path) in enumerate(scored[:100]):
        stem = Path(rel).stem
        source_title = release_source.get(r_path.resolve()) or None
        if source_title:
            source_title = (
                _pretty_franchise_name(source_title)
                or _strip_dated_folder_label(source_title)
                or source_title
            )
        raw_tracks.append(
            {
                "id": i + 1,
                "title": _clean_track_title(stem),
                "title_full": stem,
                "play_path": rel.replace("\\", "/"),
                "path": rel.replace("\\", "/"),
                "play_count": count,
                "cover_url": cover_url_for_track_path(rel, root),
                "source_title": source_title,
            }
        )
    enriched = enrich_playlist_tracks(raw_tracks, root, db=db)
    band_name_cache: dict[int, str] = {}
    out: list[dict[str, Any]] = []
    for i, row in enumerate(enriched):
        raw = raw_tracks[i] if i < len(raw_tracks) else {}
        album = (
            (row.get("album_title") or row.get("release") or "").strip() or None
        )
        nav_band = row.get("navigate_band_id")
        artist = (row.get("artist_name") or "").strip() or None
        if not artist and nav_band is not None:
            try:
                bid = int(nav_band)
            except (TypeError, ValueError):
                bid = None
            if bid is not None:
                if bid not in band_name_cache:
                    from app.models import Band

                    band = db.get(Band, bid)
                    band_name_cache[bid] = (band.bnd_name or "").strip() if band else ""
                artist = band_name_cache[bid] or None
        out.append(
            {
                "id": raw.get("id") or i + 1,
                "title": raw.get("title") or row.get("title") or "",
                "title_full": raw.get("title_full") or raw.get("title"),
                "artist_id": nav_band,
                "artist_name": artist,
                "play_count": raw.get("play_count") or 0,
                "path": raw.get("path") or row.get("play_path"),
                "release": album,
                "cover_url": raw.get("cover_url") or row.get("cover_url"),
                "navigate_band_id": nav_band,
                "navigate_release_id": row.get("navigate_release_id"),
                "source_title": raw.get("source_title"),
            }
        )
    return out


def _infer_series_leaf_from_path(path: str | None) -> tuple[str | None, str | None]:
    """Return (leaf_id, leaf_display_title) from a Series/… path."""
    media_rel = (path or "").replace("\\", "/").strip("/")
    if not media_rel.lower().startswith("series/"):
        return None, None
    from pathlib import PurePosixPath

    parts = PurePosixPath(media_rel).parts
    if len(parts) < 4:
        return None, None
    leaf_id = parts[3]
    title = _strip_dated_folder_label(leaf_id) or leaf_id
    return leaf_id, title


def _apply_franchise_home_cover(
    row: dict[str, Any],
    franchise_name: str | None,
    *,
    local_dir=None,
) -> None:
    """Fill missing cover from cross-module franchise artwork home."""
    if row.get("cover_url") or row.get("photo_url"):
        return
    name = (franchise_name or row.get("title") or "").strip()
    if not name:
        return
    try:
        from pathlib import Path

        from app.config import settings
        from app.franchise_identity import fill_missing_art_from_franchise_home

        root = Path(settings.media_root) if settings.media_root else None
        if not root:
            return
        fill_missing_art_from_franchise_home(
            row, name, root, local_franchise_dir=local_dir
        )
        if row.get("cover_url") and not row.get("photo_url"):
            row["photo_url"] = row["cover_url"]
    except Exception:
        pass


def build_module_wrapped(
    db: Session,
    user_id: int,
    module: str,
    *,
    year: int | None = None,
    nsfw_unlocked: bool = False,
) -> dict[str, Any]:
    """Year recap for one non-music module (empty until dated activity exists)."""
    mod = _norm_module(module)
    copy = _MODULE_COPY.get(mod) or _MODULE_COPY["series"]
    y = year or date.today().year
    empty_payload = {
        "year": y,
        "module": mod,
        "empty": True,
        "total_plays": 0,
        "active_days": 0,
        "current_streak": 0,
        "longest_streak": 0,
        "eyebrow": copy.get("eyebrow", ""),
        "count_label": copy.get("count_label", "plays"),
        "empty_hint": copy.get("empty_hint", ""),
        "items_tab": copy.get("items_tab", "On repeat"),
        "groups_tab": copy.get("groups_tab", "Top"),
        "franchises_tab": copy.get("franchises_tab"),
        "videos_tab": copy.get("videos_tab"),
        "tracks_tab": "Top tracks",
        "vibes_tab": copy.get("vibes_tab", "Vibes"),
        "items_rank": copy.get("items_rank", "#1"),
        "groups_rank": copy.get("groups_rank", "#1"),
        "franchises_rank": copy.get("franchises_rank"),
        "videos_rank": copy.get("videos_rank"),
        "browse_label": copy.get("browse_label", "Browse"),
        "top_items": [],
        "top_groups": [],
        "top_franchises": [],
        "top_videos": [],
        "top_tracks": [],
        "top_vibes": [],
        "browse_top": None,
        "hide_item_covers": mod == "files",
    }
    if mod not in MODULES:
        return empty_payload

    rows = _year_rows(db, user_id, mod, y)
    item_counts: Counter[str] = Counter()
    item_meta: dict[str, ModuleActivityDay] = {}
    group_counts: Counter[str] = Counter()
    group_meta: dict[str, tuple[str | None, str | None, str | None]] = {}
    # Secondary franchise counts (series shows vs franchises; hobbies themes)
    franchise_counts: Counter[str] = Counter()
    franchise_meta: dict[str, tuple[str | None, str | None]] = {}
    vibe_counts: Counter[str] = Counter()
    vibe_labels: dict[str, str] = {}
    day_set: set[str] = set()
    total_plays = 0
    year_item_totals: Counter[str] = Counter()

    for r in rows:
        n = int(r.mad_count or 0)
        if n <= 0:
            continue
        # Photos Exclusive year is NSFW-gated.
        if (
            mod == "photos"
            and not nsfw_unlocked
            and (
                (r.mad_group_id or "").strip().casefold() == "exclusive"
                or (r.mad_group_title or "").strip().casefold() == "exclusive"
                or "Photos/Exclusive" in ((r.mad_path or "").replace("\\", "/"))
            )
        ):
            continue
        total_plays += n
        day_set.add(r.mad_date or "")
        eid = (r.mad_entity_id or "").strip()
        if eid:
            item_counts[eid] += n
            year_item_totals[eid] += n
            prev = item_meta.get(eid)
            if not prev or n >= int(prev.mad_count or 0):
                item_meta[eid] = r

        if mod in {"files", "hobbies", "photos"}:
            gid = (r.mad_group_id or "").strip()
            if gid:
                group_counts[gid] += n
                group_meta[gid] = (
                    r.mad_group_title or gid,
                    r.mad_cover_url,
                    None,
                )
            # Hobbies: theme / franchise from vibe_key
            if mod == "hobbies":
                theme = (r.mad_vibe_key or r.mad_vibe_label or "").strip()
                if theme:
                    franchise_counts[theme.casefold()] += n
                    franchise_meta[theme.casefold()] = (theme, r.mad_cover_url)
        elif mod == "series":
            # Shows = leaf/group; franchises = franchise hub
            leaf_id = (r.mad_group_id or "").strip()
            leaf_title = (r.mad_group_title or "").strip() or None
            if not leaf_id:
                leaf_id, inferred = _infer_series_leaf_from_path(r.mad_path)
                leaf_title = leaf_title or inferred
            if leaf_id:
                group_counts[leaf_id] += n
                group_meta[leaf_id] = (
                    leaf_title or leaf_id,
                    r.mad_cover_url,
                    (r.mad_franchise_id or "").strip() or None,
                )
            fid = (r.mad_franchise_id or "").strip()
            if not fid and (r.mad_path or "").replace("\\", "/").lower().startswith(
                "series/"
            ):
                from pathlib import PurePosixPath

                parts = PurePosixPath(
                    (r.mad_path or "").replace("\\", "/").strip("/")
                ).parts
                if len(parts) >= 3:
                    fid = parts[2]
            if fid:
                franchise_counts[fid] += n
                franchise_meta[fid] = (
                    r.mad_franchise_title or fid,
                    r.mad_cover_url,
                )
        else:
            fid = (r.mad_franchise_id or "").strip()
            if fid:
                group_counts[fid] += n
                group_meta[fid] = (
                    r.mad_franchise_title or fid,
                    r.mad_cover_url,
                    fid,
                )

        vk = (r.mad_vibe_key or "").strip()
        if vk:
            vibe_counts[vk] += n
            if vk not in vibe_labels:
                vibe_labels[vk] = (r.mad_vibe_label or vk).strip() or vk

    # Movies: first play often lands before leaf genres resolve. Backfill vibes
    # from film meta so Wrapped Platforms/Vibes still populate.
    if mod == "movies":
        try:
            from app.movies_refresh import _load_meta, find_movie_work

            dirty = False
            for eid, n in list(item_counts.items()):
                meta = item_meta.get(eid)
                if not meta:
                    continue
                if (meta.mad_vibe_key or "").strip():
                    continue
                fid = (meta.mad_franchise_id or "").strip()
                if not fid:
                    continue
                work = find_movie_work(db, fid)
                if not work:
                    continue
                blob = _load_meta(work)
                films = blob.get("films") if isinstance(blob.get("films"), dict) else {}
                film_blob = None
                path_cf = ((meta.mad_path or eid) or "").replace("\\", "/").casefold()
                for key, fmeta in films.items():
                    if not isinstance(fmeta, dict):
                        continue
                    title = (fmeta.get("title") or key or "").strip()
                    if title and title.casefold() in path_cf:
                        film_blob = fmeta
                        break
                    if key and key.casefold() in path_cf:
                        film_blob = fmeta
                        break
                if film_blob is None and films:
                    # Fallback: work-level genres when film match fails.
                    film_blob = {"genres": blob.get("genres") or []}
                genres = film_blob.get("genres") if film_blob else None
                primary = None
                if isinstance(genres, list):
                    for g in genres:
                        if isinstance(g, dict):
                            primary = (g.get("name") or "").strip() or None
                        elif isinstance(g, str):
                            primary = g.strip() or None
                        if primary:
                            break
                if not primary:
                    continue
                vibe_counts[primary] += n
                vibe_labels.setdefault(primary, primary)
                meta.mad_vibe_key = primary
                meta.mad_vibe_label = primary
                dirty = True
            if dirty:
                db.commit()
        except Exception:
            pass

    def _build_item_row(eid: str, count: int) -> dict[str, Any]:
        meta = item_meta.get(eid)
        subtitle = None
        if meta:
            if mod == "series":
                subtitle = meta.mad_group_title or meta.mad_franchise_title
                if not subtitle:
                    _lid, inferred = _infer_series_leaf_from_path(meta.mad_path)
                    subtitle = inferred
            else:
                subtitle = meta.mad_franchise_title or meta.mad_group_title
        raw = _item_row(
            id=eid,
            title=(meta.mad_title if meta else None) or eid,
            play_count=count,
            cover_url=meta.mad_cover_url if meta else None,
            subtitle=subtitle,
            franchise_id=meta.mad_franchise_id if meta else None,
            entity_kind=meta.mad_entity_kind if meta else None,
            path=meta.mad_path if meta else None,
            group_id=meta.mad_group_id if meta else None,
            leaf_id=meta.mad_group_id if meta else None,
        )
        return _enrich_media_item(db, mod, raw)

    all_items: list[dict[str, Any]] = []
    for eid, count in item_counts.most_common(100):
        all_items.append(_build_item_row(eid, count))

    # Photos: split image vs video lists.
    top_videos: list[dict[str, Any]] = []
    if mod == "photos":
        top_items = []
        for row in all_items:
            kind = (row.get("entity_kind") or "").casefold()
            title = (row.get("title") or "").casefold()
            is_video = kind in {"video", "videos"} or title.endswith(
                (".mp4", ".mkv", ".webm", ".mov", ".m4v")
            )
            # Year opens are groups, not media items — skip bare year ids.
            if kind == "year":
                continue
            row["count_label"] = "plays" if is_video else "views"
            if is_video:
                top_videos.append(row)
            else:
                top_items.append(row)
    else:
        top_items = all_items

    def _resolve_local_franchise_dir(gid: str):
        from pathlib import Path

        from app.config import settings

        root = Path(settings.media_root) if settings.media_root else None
        if not root:
            return None, None
        fdir = None
        try:
            if mod == "games":
                from app.games_index import find_work_dir

                hit = find_work_dir(gid, root)
                if hit:
                    fdir = hit[0]
            elif mod == "books":
                from app.books_index import find_work_dir

                hit = find_work_dir(gid, root)
                if hit:
                    fdir = hit[0]
            elif mod == "movies":
                from app.movies_index import find_work_dir

                hit = find_work_dir(gid, root)
                if hit:
                    fdir = hit[0] if isinstance(hit, tuple) else hit
            elif mod == "series":
                from app.series_index import find_franchise_dir

                # Show leaf: Series/{L}/{Franchise}/{Leaf}
                hit = find_franchise_dir(gid, root)
                if hit:
                    fdir = hit[0]
                    # Prefer leaf folder when gid is a dated leaf under franchise.
                    leaf = fdir / gid
                    if leaf.is_dir():
                        fdir = leaf
                    else:
                        # Search children for matching leaf id
                        want = gid.casefold()
                        try:
                            for child in fdir.iterdir():
                                if (
                                    child.is_dir()
                                    and not child.name.startswith(".")
                                    and child.name.casefold() == want
                                ):
                                    fdir = child
                                    break
                        except OSError:
                            pass
        except Exception:
            fdir = None
        return root, fdir

    def _finish_group_row(
        row: dict[str, Any],
        *,
        franchise_name: str | None,
        local_lookup_id: str | None = None,
    ) -> dict[str, Any]:
        look = local_lookup_id or (row.get("franchise_id") or row.get("id"))
        root, fdir = _resolve_local_franchise_dir(str(look or ""))
        if fdir is not None and fdir.is_dir():
            display = _strip_dated_folder_label(fdir.name) or fdir.name
            # Keep explicit pretty titles for shows; refresh bare ids.
            if not row.get("title") or row["title"] == row.get("id"):
                row["title"] = display
                row["name"] = display
            if not row.get("cover_url"):
                try:
                    from app.series_index import _series_folder_cover

                    if root is not None:
                        art = _series_folder_cover(fdir, root)
                        if art:
                            row["cover_url"] = art
                            row["photo_url"] = art
                except Exception:
                    pass
        art_name = franchise_name or row.get("title")
        _apply_franchise_home_cover(row, art_name, local_dir=fdir)
        return row

    top_groups: list[dict[str, Any]] = []
    for gid, count in group_counts.most_common(15):
        title, cover, fid = group_meta.get(gid) or (gid, None, None)
        pretty = _pretty_franchise_name(title) or title or gid
        row = _item_row(
            id=gid,
            title=pretty,
            play_count=count,
            cover_url=cover,
            franchise_id=fid
            or (gid if mod not in {"files", "hobbies", "photos", "series"} else None),
            group_id=gid
            if mod in {"files", "hobbies", "photos", "series"}
            else None,
        )
        if mod == "series":
            # Shows: art from leaf, fall back to franchise home via franchise id.
            top_groups.append(
                _finish_group_row(
                    row,
                    franchise_name=fid or pretty,
                    local_lookup_id=fid or gid,
                )
            )
        elif mod not in {"files", "hobbies", "photos"}:
            top_groups.append(
                _finish_group_row(row, franchise_name=pretty, local_lookup_id=gid)
            )
        else:
            top_groups.append(row)

    top_franchises: list[dict[str, Any]] = []
    if mod == "series":
        for fid, count in franchise_counts.most_common(15):
            title, cover = franchise_meta.get(fid) or (fid, None)
            pretty = _pretty_franchise_name(title) or title or fid
            row = _item_row(
                id=fid,
                title=pretty,
                play_count=count,
                cover_url=cover,
                franchise_id=fid,
            )
            top_franchises.append(
                _finish_group_row(row, franchise_name=pretty, local_lookup_id=fid)
            )
    elif mod == "hobbies":
        for key, count in franchise_counts.most_common(15):
            title, cover = franchise_meta.get(key) or (key, None)
            pretty = _pretty_franchise_name(title) or title or key
            row = _item_row(
                id=pretty,
                title=pretty,
                play_count=count,
                cover_url=cover,
                franchise_id=pretty,
                vibe_key=pretty,
            )
            _apply_franchise_home_cover(row, pretty)
            top_franchises.append(row)

    # Enrich hobby item / collection covers from DB when missing.
    if mod == "hobbies":
        try:
            from app.hobbies import (
                collection_is_private,
                get_collection,
                item_image_url,
                item_is_private,
            )
            from app.models import HobbyItem

            for row in top_items:
                eid = str(row.get("id") or "")
                try:
                    iid = int(eid)
                except ValueError:
                    continue
                item = db.get(HobbyItem, iid)
                if not item or int(item.hbi_user_id or 0) != int(user_id):
                    continue
                if item_is_private(item) and not nsfw_unlocked:
                    row["_nsfw_hide"] = True
                    continue
                img = item_image_url(item.hbi_image_path, item.hbi_image_url)
                if img:
                    row["cover_url"] = img
                    row["photo_url"] = img
                elif not row.get("cover_url"):
                    coll = get_collection(db, user_id, int(item.hbi_collection_id))
                    if coll and not (
                        collection_is_private(coll) and not nsfw_unlocked
                    ):
                        from app.hobbies import _collection_art_bundle

                        art = _collection_art_bundle(coll)
                        cover = art.get("cover_url")
                        if cover:
                            row["cover_url"] = cover
                            row["photo_url"] = cover
                row["group_id"] = str(item.hbi_collection_id)
            top_items = [r for r in top_items if not r.pop("_nsfw_hide", False)]

            for row in top_groups:
                try:
                    cid = int(str(row.get("id") or row.get("group_id") or ""))
                except ValueError:
                    continue
                coll = get_collection(db, user_id, cid)
                if not coll:
                    continue
                if collection_is_private(coll) and not nsfw_unlocked:
                    row["_nsfw_hide"] = True
                    continue
                if not row.get("cover_url"):
                    from app.hobbies import _collection_art_bundle

                    art = _collection_art_bundle(coll)
                    cover = art.get("cover_url")
                    if cover:
                        row["cover_url"] = cover
                        row["photo_url"] = cover
            top_groups = [r for r in top_groups if not r.pop("_nsfw_hide", False)]
        except Exception:
            pass

    # NSFW: drop adult media franchises / leaves when locked.
    if not nsfw_unlocked and mod in {"series", "movies", "books", "games"}:
        try:
            from app.adult_content import (
                movie_work_is_sfw,
                series_franchise_is_sfw,
                series_leaf_is_adult,
            )

            def _row_ok(row: dict[str, Any]) -> bool:
                fid = (row.get("franchise_id") or row.get("id") or "").strip()
                if mod == "series":
                    if fid and not series_franchise_is_sfw(db, fid):
                        return False
                    leaf = (row.get("leaf_id") or row.get("group_id") or "").strip()
                    if leaf and series_leaf_is_adult(db, fid, leaf):
                        return False
                    return True
                if mod == "movies":
                    return movie_work_is_sfw(db, fid) if fid else True
                # books/games: keep unless franchise id fails a movies-style check later
                return True

            top_items = [r for r in top_items if _row_ok(r)]
            top_groups = [r for r in top_groups if _row_ok(r)]
            top_franchises = [r for r in top_franchises if _row_ok(r)]
        except Exception:
            pass

    top_vibes: list[dict[str, Any]] = []
    once_limit = 10 if mod in {"files", "photos"} else 40
    if mod in {"files", "hobbies", "photos"}:
        once = [
            (eid, 1)
            for eid, total in year_item_totals.items()
            if total == 1
        ]
        once.sort(
            key=lambda pair: (
                (item_meta[pair[0]].mad_title or pair[0]).casefold()
                if pair[0] in item_meta
                else pair[0].casefold()
            )
        )
        for eid, count in once[:once_limit]:
            meta = item_meta.get(eid)
            if (
                mod == "photos"
                and not nsfw_unlocked
                and (
                    (meta.mad_group_id if meta else "") or ""
                ).strip().casefold()
                == "exclusive"
            ):
                continue
            kind = (meta.mad_entity_kind if meta else None) or None
            if mod == "photos" and (kind or "").casefold() == "year":
                continue
            row = _enrich_media_item(
                db,
                mod,
                _item_row(
                    id=eid,
                    title=(meta.mad_title if meta else None) or eid,
                    play_count=count,
                    cover_url=meta.mad_cover_url if meta else None,
                    subtitle=(
                        (meta.mad_group_title if meta else None)
                        or (meta.mad_franchise_title if meta else None)
                    ),
                    franchise_id=meta.mad_franchise_id if meta else None,
                    entity_kind=kind,
                    path=meta.mad_path if meta else None,
                    group_id=meta.mad_group_id if meta else None,
                ),
            )
            if mod == "photos":
                is_video = (kind or "").casefold() in {"video", "videos"}
                row["count_label"] = "plays" if is_video else "views"
            top_vibes.append(row)
    else:
        for vk, count in vibe_counts.most_common(15):
            top_vibes.append(
                _item_row(
                    id=vk,
                    title=vibe_labels.get(vk) or vk,
                    play_count=count,
                    vibe_key=vk,
                    image_url=None,
                )
            )

    top_tracks: list[dict[str, Any]] = []
    if mod in {"series", "movies", "books", "games"}:
        try:
            top_tracks = _module_top_tracks(db, user_id, mod, y)
            # Honor NSFW gate for soundtrack owners.
            if not nsfw_unlocked:
                from app.module_home_audio import _cached_audio_owners

                _ = _cached_audio_owners(mod, db, nsfw_unlocked=False)
        except Exception:
            top_tracks = []

    days = _user_days(db, user_id, mod)
    current, longest = _streak_from_days(days)

    return {
        "year": y,
        "module": mod,
        "empty": total_plays == 0 and not top_tracks and not top_items,
        "total_plays": total_plays,
        "active_days": len(day_set),
        "current_streak": current,
        "longest_streak": longest,
        "eyebrow": copy["eyebrow"],
        "count_label": copy["count_label"],
        "empty_hint": copy["empty_hint"],
        "items_tab": copy["items_tab"],
        "groups_tab": copy["groups_tab"],
        "franchises_tab": copy.get("franchises_tab"),
        "videos_tab": copy.get("videos_tab"),
        "tracks_tab": "Top tracks",
        "vibes_tab": copy["vibes_tab"],
        "items_rank": copy["items_rank"],
        "groups_rank": copy["groups_rank"],
        "franchises_rank": copy.get("franchises_rank"),
        "videos_rank": copy.get("videos_rank"),
        "browse_label": copy["browse_label"],
        "top_items": top_items,
        "top_groups": top_groups,
        "top_franchises": top_franchises,
        "top_videos": top_videos,
        "top_tracks": top_tracks,
        "top_vibes": top_vibes,
        "browse_top": None,
        "hide_item_covers": mod == "files",
    }
