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
    {"series", "movies", "books", "games", "files", "hobbies"}
)

_MODULE_COPY: dict[str, dict[str, str]] = {
    "series": {
        "eyebrow": "Your year in shows",
        "count_label": "plays",
        "empty_hint": "Watch episodes from today onward — Wrapped fills in as you go.",
        "items_tab": "On repeat",
        "groups_tab": "Top shows",
        "vibes_tab": "Vibes",
        "items_rank": "#1 On repeat",
        "groups_rank": "#1 Show",
        "browse_label": "Browse top show",
    },
    "movies": {
        "eyebrow": "Your year in film",
        "count_label": "plays",
        "empty_hint": "Watch films from today onward — Wrapped fills in as you go.",
        "items_tab": "On repeat",
        "groups_tab": "Top franchises",
        "vibes_tab": "Vibes",
        "items_rank": "#1 On repeat",
        "groups_rank": "#1 Franchise",
        "browse_label": "Browse top franchise",
    },
    "books": {
        "eyebrow": "Your year in pages",
        "count_label": "opens",
        "empty_hint": "Open books from today onward — Wrapped fills in as you go.",
        "items_tab": "On repeat",
        "groups_tab": "Top works",
        "vibes_tab": "Vibes",
        "items_rank": "#1 On repeat",
        "groups_rank": "#1 Work",
        "browse_label": "Browse top work",
    },
    "games": {
        "eyebrow": "Your year in play",
        "count_label": "opens",
        "empty_hint": "Open games from today onward — Wrapped fills in as you go.",
        "items_tab": "On repeat",
        "groups_tab": "Top franchises",
        "vibes_tab": "Platforms",
        "items_rank": "#1 On repeat",
        "groups_rank": "#1 Franchise",
        "browse_label": "Browse top franchise",
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
        "count_label": "touches",
        "empty_hint": "Open or edit hobby items from today onward — Wrapped fills in as you go.",
        "items_tab": "Most touched",
        "groups_tab": "Top collections",
        "vibes_tab": "Only once",
        "items_rank": "#1 Item",
        "groups_rank": "#1 Collection",
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
    if row:
        row.mad_count = int(row.mad_count or 0) + 1
        if title and not row.mad_title:
            row.mad_title = title
        if path and not row.mad_path:
            row.mad_path = path
        if franchise_id and not row.mad_franchise_id:
            row.mad_franchise_id = franchise_id
        if franchise_title and not row.mad_franchise_title:
            row.mad_franchise_title = franchise_title
        if cover_url and not row.mad_cover_url:
            row.mad_cover_url = cover_url
        if group_id and not row.mad_group_id:
            row.mad_group_id = group_id
        if group_title and not row.mad_group_title:
            row.mad_group_title = group_title
        if vibe_key and not row.mad_vibe_key:
            row.mad_vibe_key = vibe_key
        if vibe_label and not row.mad_vibe_label:
            row.mad_vibe_label = vibe_label
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
        "vibe_key": vibe_key,
    }


def build_module_wrapped(
    db: Session,
    user_id: int,
    module: str,
    *,
    year: int | None = None,
) -> dict[str, Any]:
    """Year recap for one non-music module (empty until dated activity exists)."""
    mod = _norm_module(module)
    copy = _MODULE_COPY.get(mod) or _MODULE_COPY["series"]
    y = year or date.today().year
    if mod not in MODULES:
        return {
            "year": y,
            "module": mod,
            "empty": True,
            "total_plays": 0,
            "active_days": 0,
            "current_streak": 0,
            "longest_streak": 0,
            **{k: copy[k] for k in (
                "eyebrow",
                "count_label",
                "empty_hint",
                "items_tab",
                "groups_tab",
                "vibes_tab",
                "items_rank",
                "groups_rank",
                "browse_label",
            )},
            "top_items": [],
            "top_groups": [],
            "top_vibes": [],
            "browse_top": None,
        }

    rows = _year_rows(db, user_id, mod, y)
    item_counts: Counter[str] = Counter()
    item_meta: dict[str, ModuleActivityDay] = {}
    group_counts: Counter[str] = Counter()
    group_meta: dict[str, tuple[str | None, str | None, str | None]] = {}
    # group_id -> (title, cover, franchise_id for browse)
    vibe_counts: Counter[str] = Counter()
    vibe_labels: dict[str, str] = {}
    day_set: set[str] = set()
    total_plays = 0
    # For "only once" tabs: entity_id -> total year count
    year_item_totals: Counter[str] = Counter()

    for r in rows:
        n = int(r.mad_count or 0)
        if n <= 0:
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

        # Groups: franchise for media; group_id for files/hobbies
        if mod in {"files", "hobbies"}:
            gid = (r.mad_group_id or "").strip()
            if gid:
                group_counts[gid] += n
                group_meta[gid] = (
                    r.mad_group_title or gid,
                    r.mad_cover_url,
                    None,
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

    top_items: list[dict[str, Any]] = []
    for i, (eid, count) in enumerate(item_counts.most_common(100)):
        meta = item_meta.get(eid)
        top_items.append(
            _item_row(
                id=eid,
                title=(meta.mad_title if meta else None) or eid,
                play_count=count,
                cover_url=meta.mad_cover_url if meta else None,
                subtitle=(
                    (meta.mad_franchise_title if meta else None)
                    or (meta.mad_group_title if meta else None)
                ),
                franchise_id=meta.mad_franchise_id if meta else None,
                entity_kind=meta.mad_entity_kind if meta else None,
                path=meta.mad_path if meta else None,
                group_id=meta.mad_group_id if meta else None,
            )
        )

    top_groups: list[dict[str, Any]] = []
    for gid, count in group_counts.most_common(15):
        title, cover, fid = group_meta.get(gid) or (gid, None, None)
        top_groups.append(
            _item_row(
                id=gid,
                title=title or gid,
                play_count=count,
                cover_url=cover,
                franchise_id=fid or (gid if mod not in {"files", "hobbies"} else None),
                group_id=gid if mod in {"files", "hobbies"} else None,
            )
        )

    top_vibes: list[dict[str, Any]] = []
    if mod in {"files", "hobbies"}:
        # "Only once" — entities with exactly one touch this year.
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
        for eid, count in once[:40]:
            meta = item_meta.get(eid)
            top_vibes.append(
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
                    entity_kind=meta.mad_entity_kind if meta else None,
                    path=meta.mad_path if meta else None,
                    group_id=meta.mad_group_id if meta else None,
                )
            )
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

    days = _user_days(db, user_id, mod)
    current, longest = _streak_from_days(days)

    browse_top = None
    if top_groups:
        g0 = top_groups[0]
        browse_top = {
            "id": g0["id"],
            "title": g0["title"],
            "franchise_id": g0.get("franchise_id"),
            "group_id": g0.get("group_id"),
            "label": copy["browse_label"],
        }

    return {
        "year": y,
        "module": mod,
        "empty": total_plays == 0,
        "total_plays": total_plays,
        "active_days": len(day_set),
        "current_streak": current,
        "longest_streak": longest,
        "eyebrow": copy["eyebrow"],
        "count_label": copy["count_label"],
        "empty_hint": copy["empty_hint"],
        "items_tab": copy["items_tab"],
        "groups_tab": copy["groups_tab"],
        "vibes_tab": copy["vibes_tab"],
        "items_rank": copy["items_rank"],
        "groups_rank": copy["groups_rank"],
        "browse_label": copy["browse_label"],
        "top_items": top_items,
        "top_groups": top_groups,
        "top_vibes": top_vibes,
        "browse_top": browse_top,
    }
