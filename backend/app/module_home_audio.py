"""Module home audio pools — up to 10 linked Soundtrack tracks.

Series / Movies / Books / Games store Music releases as ``Audio/`` ``.lnk``
shortcuts. The home bubble samples across distinct Music releases first, then
fills from remaining tracks (same release only if needed) until 10.
"""

from __future__ import annotations

import random
import time
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import settings
from app.media_paths_util import safe_relative
from app.module_catalog_cache import get_or_build_catalog, _listing_sig_cached
from app.paths import DATA_DIR
from app.series_extras import collect_audio_tracks_from_folders
from app.series_paths import find_audio_bucket

POOL_LIMIT = 10
_INVENTORY_TTL_SEC = 90.0
# module -> (listing_sig, expires_mono, owner_folders: list[Path as posix rel])
_inventory_mem: dict[str, tuple[str, float, list[str]]] = {}


def _media_root() -> Path | None:
    root = Path(settings.media_root) if settings.media_root else None
    if not root or not root.is_dir():
        return None
    return root


def _owner_folders_series(db: Session, *, nsfw_unlocked: bool) -> list[Path]:
    from app.adult_content import adult_subgenre_names_from_db, filter_adult_cards
    from app.series_catalog_meta import (
        enrich_catalog_metadata,
        filter_franchise_subseries_lists,
    )
    from app.series_index import build_series_catalog

    root = _media_root()
    if not root:
        return []
    catalog = get_or_build_catalog(
        "series", media_root=root, builder=lambda: build_series_catalog(root)
    )
    catalog = enrich_catalog_metadata(db, catalog)
    adult_subs = adult_subgenre_names_from_db(db)
    franchises = filter_adult_cards(
        catalog.get("franchises") or [],
        nsfw_unlocked=nsfw_unlocked,
        extra_adult_subgenres=adult_subs,
    )
    franchises = filter_franchise_subseries_lists(
        franchises,
        nsfw_unlocked=nsfw_unlocked,
        extra_adult_subgenres=adult_subs,
    )
    out: list[Path] = []
    for fr in franchises:
        fp = (fr.get("folder_path") or "").replace("\\", "/").strip("/")
        if fp:
            out.append(root / fp)
        for sub in fr.get("subseries") or []:
            sp = (sub.get("folder_path") or "").replace("\\", "/").strip("/")
            if sp:
                out.append(root / sp)
    return out


def _flat_catalog_leaves(
    db: Session,
    *,
    module: str,
    builder,
    leaf_key: str,
    nsfw_unlocked: bool,
) -> list[dict]:
    from app.adult_content import adult_subgenre_names_from_db, filter_adult_cards

    root = _media_root()
    if not root:
        return []
    catalog = get_or_build_catalog(
        module, media_root=root, builder=lambda: builder(root)
    )
    adult_subs = adult_subgenre_names_from_db(db)
    return filter_adult_cards(
        catalog.get(leaf_key) or [],
        nsfw_unlocked=nsfw_unlocked,
        extra_adult_subgenres=adult_subs,
    )


def _owner_folders_from_flat(
    db: Session,
    *,
    module: str,
    builder,
    leaf_key: str,
    nsfw_unlocked: bool,
) -> list[Path]:
    root = _media_root()
    if not root:
        return []
    leaves = _flat_catalog_leaves(
        db,
        module=module,
        builder=builder,
        leaf_key=leaf_key,
        nsfw_unlocked=nsfw_unlocked,
    )
    out: list[Path] = []
    for leaf in leaves:
        fp = (leaf.get("folder_path") or "").replace("\\", "/").strip("/")
        if fp:
            out.append(root / fp)
    return out


def _owner_folders_movies(db: Session, *, nsfw_unlocked: bool) -> list[Path]:
    from app.movies_index import build_movies_catalog

    return _owner_folders_from_flat(
        db,
        module="movies",
        builder=build_movies_catalog,
        leaf_key="films",
        nsfw_unlocked=nsfw_unlocked,
    )


def _owner_folders_books(db: Session, *, nsfw_unlocked: bool) -> list[Path]:
    from app.books_index import build_books_catalog

    return _owner_folders_from_flat(
        db,
        module="books",
        builder=build_books_catalog,
        leaf_key="books",
        nsfw_unlocked=nsfw_unlocked,
    )


def _owner_folders_games(db: Session, *, nsfw_unlocked: bool) -> list[Path]:
    from app.games_index import build_games_catalog

    return _owner_folders_from_flat(
        db,
        module="games",
        builder=build_games_catalog,
        leaf_key="games",
        nsfw_unlocked=nsfw_unlocked,
    )


def _folders_with_audio_shortcuts(folders: list[Path]) -> list[Path]:
    """Keep only owners that have at least one Audio/ ``.lnk`` / ``.path`` / symlink."""
    hit: list[Path] = []
    for folder in folders:
        if not folder.is_dir():
            continue
        bucket = find_audio_bucket(folder)
        if not bucket:
            continue
        # Cheap presence check — avoid resolving every lnk until sample time.
        # Do not treat bare category folders as audio (scaffolding alone).
        try:
            for child in bucket.iterdir():
                if child.is_dir():
                    for entry in child.iterdir():
                        low = entry.suffix.casefold()
                        if entry.is_symlink() or low in {".lnk", ".path"}:
                            hit.append(folder)
                            raise StopIteration
                low = child.suffix.casefold()
                if child.is_symlink() or low in {".lnk", ".path"}:
                    hit.append(folder)
                    raise StopIteration
        except StopIteration:
            continue
        except OSError:
            continue
    return hit


def _owner_folders(
    module: str, db: Session, *, nsfw_unlocked: bool
) -> list[Path]:
    mod = module.casefold()
    if mod == "series":
        return _owner_folders_series(db, nsfw_unlocked=nsfw_unlocked)
    if mod == "movies":
        return _owner_folders_movies(db, nsfw_unlocked=nsfw_unlocked)
    if mod == "books":
        return _owner_folders_books(db, nsfw_unlocked=nsfw_unlocked)
    if mod == "games":
        return _owner_folders_games(db, nsfw_unlocked=nsfw_unlocked)
    return []


def _cached_audio_owners(
    module: str, db: Session, *, nsfw_unlocked: bool
) -> list[Path]:
    root = _media_root()
    if not root:
        return []
    mod = module.casefold()
    listing = _listing_sig_cached(root, mod)
    gate = "1" if nsfw_unlocked else "0"
    key = f"{mod}:{gate}"
    now = time.monotonic()
    hit = _inventory_mem.get(key)
    if hit and hit[0] == listing and hit[1] > now:
        return [root / rel for rel in hit[2] if (root / rel).is_dir()]

    folders = _folders_with_audio_shortcuts(
        _owner_folders(mod, db, nsfw_unlocked=nsfw_unlocked)
    )
    rels: list[str] = []
    for p in folders:
        rel = safe_relative(p, root)
        if rel:
            rels.append(rel.replace("\\", "/"))
    _inventory_mem[key] = (listing, now + _INVENTORY_TTL_SEC, rels)
    try:
        (DATA_DIR / "catalog_cache").mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return folders


def _leaf_meta_by_folder(
    module: str, db: Session, *, nsfw_unlocked: bool
) -> dict[str, dict]:
    """Map leaf folder_path (casefold) → navigation/source fields."""
    mod = module.casefold()
    root = _media_root()
    if not root:
        return {}
    out: dict[str, dict] = {}

    def add(folder_path: str | None, meta: dict) -> None:
        fp = (folder_path or "").replace("\\", "/").strip("/").casefold()
        if fp:
            out[fp] = meta

    if mod == "series":
        from app.adult_content import adult_subgenre_names_from_db, filter_adult_cards
        from app.series_catalog_meta import (
            enrich_catalog_metadata,
            filter_franchise_subseries_lists,
        )
        from app.series_index import build_series_catalog

        catalog = get_or_build_catalog(
            "series", media_root=root, builder=lambda: build_series_catalog(root)
        )
        catalog = enrich_catalog_metadata(db, catalog)
        adult_subs = adult_subgenre_names_from_db(db)
        franchises = filter_adult_cards(
            catalog.get("franchises") or [],
            nsfw_unlocked=nsfw_unlocked,
            extra_adult_subgenres=adult_subs,
        )
        franchises = filter_franchise_subseries_lists(
            franchises,
            nsfw_unlocked=nsfw_unlocked,
            extra_adult_subgenres=adult_subs,
        )
        for fr in franchises:
            fid = fr.get("id") or ""
            fname = fr.get("name") or fid
            add(
                fr.get("folder_path"),
                {
                    "source_module": "series",
                    "source_title": fname,
                    "source_franchise_id": fid,
                    "source_leaf_id": None,
                },
            )
            for sub in fr.get("subseries") or []:
                add(
                    sub.get("folder_path"),
                    {
                        "source_module": "series",
                        "source_title": sub.get("title") or sub.get("id") or fname,
                        "source_franchise_id": fid,
                        "source_leaf_id": sub.get("id"),
                    },
                )
        return out

    if mod == "movies":
        from app.movies_index import build_movies_catalog

        leaves = _flat_catalog_leaves(
            db,
            module="movies",
            builder=build_movies_catalog,
            leaf_key="films",
            nsfw_unlocked=nsfw_unlocked,
        )
        for leaf in leaves:
            add(
                leaf.get("folder_path"),
                {
                    "source_module": "movies",
                    "source_title": leaf.get("title") or leaf.get("id"),
                    "source_franchise_id": leaf.get("work_id")
                    or leaf.get("work_name"),
                    "source_leaf_id": leaf.get("id"),
                },
            )
        return out

    if mod == "books":
        from app.books_index import build_books_catalog

        leaves = _flat_catalog_leaves(
            db,
            module="books",
            builder=build_books_catalog,
            leaf_key="books",
            nsfw_unlocked=nsfw_unlocked,
        )
        for leaf in leaves:
            add(
                leaf.get("folder_path"),
                {
                    "source_module": "books",
                    "source_title": leaf.get("title") or leaf.get("id"),
                    "source_franchise_id": leaf.get("work_id")
                    or leaf.get("work_name"),
                    "source_leaf_id": leaf.get("id"),
                },
            )
        return out

    if mod == "games":
        from app.games_index import build_games_catalog

        leaves = _flat_catalog_leaves(
            db,
            module="games",
            builder=build_games_catalog,
            leaf_key="games",
            nsfw_unlocked=nsfw_unlocked,
        )
        for leaf in leaves:
            add(
                leaf.get("folder_path"),
                {
                    "source_module": "games",
                    "source_title": leaf.get("title") or leaf.get("id"),
                    "source_franchise_id": leaf.get("work_id")
                    or leaf.get("work_name"),
                    "source_leaf_id": leaf.get("id"),
                },
            )
        return out

    return out


def _annotate_track(
    track: dict,
    owner: Path,
    root: Path,
    leaf_meta: dict[str, dict],
    module: str,
) -> dict:
    rel = safe_relative(owner, root) or ""
    rel_cf = rel.replace("\\", "/").strip("/").casefold()
    meta = leaf_meta.get(rel_cf) or {
        "source_module": module.casefold(),
        "source_title": owner.name,
        "source_franchise_id": None,
        "source_leaf_id": None,
    }
    out = dict(track)
    out.update(meta)
    out["source_folder_path"] = rel.replace("\\", "/") if rel else None
    return out


def _release_key(track: dict) -> str:
    """Identity for soundtrack diversity (prefer Music release id)."""
    rid = track.get("navigate_release_id")
    if rid is not None and str(rid).strip():
        return f"rel:{str(rid).strip().casefold()}"
    title = (track.get("release_title") or "").strip()
    if title:
        return f"title:{title.casefold()}"
    path = (track.get("play_path") or "").replace("\\", "/").strip("/")
    if path:
        parent = "/".join(path.split("/")[:-1])
        if parent:
            return f"dir:{parent.casefold()}"
    return f"trk:{(track.get('id') or path or 'unknown').casefold()}"


def build_module_home_audio_pool(
    module: str,
    db: Session,
    *,
    nsfw_unlocked: bool = False,
    limit: int = POOL_LIMIT,
) -> list[dict]:
    """Return up to ``limit`` playable tracks for the module home bubble.

    Prefers one track per distinct Music release linked from the module, then
    fills with unused tracks from other releases. Only reuses the same release
    when fewer distinct releases/tracks exist than ``limit``.
    """
    root = _media_root()
    if not root:
        return []
    mod = module.casefold()
    owners = _cached_audio_owners(mod, db, nsfw_unlocked=nsfw_unlocked)
    if not owners:
        return []
    leaf_meta = _leaf_meta_by_folder(mod, db, nsfw_unlocked=nsfw_unlocked)
    target = max(1, int(limit))

    # release_key → play_path → annotated track variants (different leaf sources)
    by_release: dict[str, dict[str, list[dict]]] = {}
    for folder in owners:
        tracks = collect_audio_tracks_from_folders(
            db,
            [folder],
            root,
            shortcuts_only=True,
        )
        if not tracks:
            continue
        for t in tracks:
            annotated = _annotate_track(t, folder, root, leaf_meta, mod)
            path = (annotated.get("play_path") or "").strip()
            if not path:
                continue
            key = _release_key(annotated)
            by_release.setdefault(key, {}).setdefault(path, []).append(annotated)

    if not by_release:
        return []

    def pick_variant(variants: list[dict]) -> dict:
        return dict(random.choice(variants))

    release_keys = list(by_release.keys())
    random.shuffle(release_keys)
    out: list[dict] = []
    seen_paths: set[str] = set()

    # Pass 1 — one track from each distinct release.
    for key in release_keys:
        if len(out) >= target:
            break
        path_map = by_release[key]
        unused = [p for p in path_map if p not in seen_paths]
        if not unused:
            continue
        path = random.choice(unused)
        seen_paths.add(path)
        out.append(pick_variant(path_map[path]))

    # Pass 2 — more unused tracks, still preferring unused releases first.
    if len(out) < target:
        pool: list[tuple[str, str]] = []  # (release_key, play_path)
        for key, path_map in by_release.items():
            for path in path_map:
                if path not in seen_paths:
                    pool.append((key, path))
        random.shuffle(pool)
        for _key, path in pool:
            if len(out) >= target:
                break
            if path in seen_paths:
                continue
            seen_paths.add(path)
            out.append(pick_variant(by_release[_key][path]))

    # Pass 3 — still short (few releases): sample with replacement.
    if len(out) < target:
        all_variants = [
            variants[0]
            for path_map in by_release.values()
            for variants in path_map.values()
            if variants
        ]
        if all_variants:
            need = target - len(out)
            extras = random.choices(all_variants, k=need)
            for i, t in enumerate(extras):
                row = dict(t)
                row["id"] = f"{t.get('id') or 'trk'}_r{i}_{len(out)}"
                out.append(row)

    random.shuffle(out)
    return out[:target]
