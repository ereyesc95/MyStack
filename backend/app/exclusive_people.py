"""Cross-source Exclusive person tabs (Music members, leaf cast, Photos/Exclusive)."""
from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy.orm import Session

from app.exclusive_gallery import (
    GALLERY_MEDIA_EXTS,
    _collect_media_items,
    _subsection_key,
    build_exclusive_section,
    find_exclusive_dir,
    has_exclusive_content,
)

_PUNCT_RE = re.compile(r"[^\w\s]+", re.UNICODE)


def normalize_person_key(name: str | None) -> str:
    """Casefold + light punctuation normalize for Exclusive/{name} matching."""
    text = (name or "").strip().casefold()
    if not text:
        return ""
    text = _PUNCT_RE.sub(" ", text)
    return " ".join(text.split())


def _photos_exclusive_root(media_root: Path) -> Path | None:
    photos = media_root / "Photos" / "Exclusive"
    if photos.is_dir():
        return photos
    try:
        photos_parent = media_root / "Photos"
        if not photos_parent.is_dir():
            return None
        for child in photos_parent.iterdir():
            if child.is_dir() and child.name.casefold() == "exclusive":
                return child
    except OSError:
        return None
    return None


def find_photos_exclusive_dir(media_root: Path, person_name: str) -> Path | None:
    """Locate Photos/Exclusive/{person} with light name normalize."""
    root = _photos_exclusive_root(media_root)
    if not root:
        return None
    want = normalize_person_key(person_name)
    if not want:
        return None
    # Exact / casefold first
    direct = root / person_name.strip()
    if direct.is_dir():
        return direct
    try:
        for child in root.iterdir():
            if not child.is_dir() or child.name.startswith("."):
                continue
            if child.name.casefold() == person_name.strip().casefold():
                return child
            if normalize_person_key(child.name) == want:
                return child
    except OSError:
        return None
    return None


def find_music_exclusive_dir(media_root: Path, artist_name: str) -> Path | None:
    """Music/{Letter}/{Artist}/[Artwork]/Exclusive when the artist folder exists."""
    from app.gallery import _artist_dir

    artist_dir = _artist_dir(media_root, artist_name)
    if not artist_dir:
        return None
    return find_exclusive_dir(artist_dir, layout="music")


def _dir_has_media(folder: Path) -> bool:
    try:
        for path in folder.rglob("*"):
            if path.is_file() and path.suffix.lower() in GALLERY_MEDIA_EXTS:
                return True
    except OSError:
        pass
    return False


def collect_exclusive_dirs_for_person(
    media_root: Path,
    person_name: str,
    *,
    leaf_exclusive: Path | None = None,
) -> list[Path]:
    """Music Exclusive + Photos/Exclusive (+ optional leaf Exclusive) for one person."""
    dirs: list[Path] = []
    seen: set[str] = set()

    def _add(p: Path | None) -> None:
        if not p or not p.is_dir():
            return
        try:
            key = str(p.resolve())
        except OSError:
            key = str(p)
        if key in seen:
            return
        if not _dir_has_media(p):
            return
        seen.add(key)
        dirs.append(p)

    _add(leaf_exclusive)
    _add(find_music_exclusive_dir(media_root, person_name))
    _add(find_photos_exclusive_dir(media_root, person_name))
    return dirs


def merge_exclusive_dirs(dirs: list[Path], media_root: Path) -> dict | None:
    """Merge one or more Exclusive roots into a single section-shaped dict."""
    if not dirs:
        return None
    if len(dirs) == 1:
        return build_exclusive_section(dirs[0], media_root)

    root_items: list[dict] = []
    subs_by_key: dict[str, dict] = {}
    seen_ids: set[str] = set()

    def _take(items: list[dict]) -> list[dict]:
        out: list[dict] = []
        for it in items:
            iid = str(it.get("id") or "")
            if iid and iid in seen_ids:
                continue
            if iid:
                seen_ids.add(iid)
            out.append(it)
        return out

    for exclusive_dir in dirs:
        sec = build_exclusive_section(exclusive_dir, media_root)
        if not sec:
            continue
        root_items.extend(_take(list(sec.get("items") or [])))
        for sub in sec.get("subsections") or []:
            key = sub.get("key") or _subsection_key(sub.get("label") or "folder")
            fresh = _take(list(sub.get("items") or []))
            if not fresh:
                continue
            if key in subs_by_key:
                subs_by_key[key]["items"].extend(fresh)
            else:
                subs_by_key[key] = {
                    "key": key,
                    "label": sub.get("label") or key,
                    "items": list(fresh),
                }

    if subs_by_key and root_items:
        if "_root" in subs_by_key:
            subs_by_key["_root"]["items"] = root_items + list(
                subs_by_key["_root"]["items"]
            )
        else:
            # Keep General first
            ordered = {
                "_root": {"key": "_root", "label": "General", "items": root_items}
            }
            ordered.update(subs_by_key)
            subs_by_key = ordered
        root_items = []

    subsections = list(subs_by_key.values())
    if not root_items and not subsections:
        return None
    out: dict = {
        "key": "exclusive",
        "label": "Exclusive",
        "items": root_items if not subsections else [],
    }
    if subsections:
        out["subsections"] = subsections
    return out


def _person_entry(label: str, dirs: list[Path], media_root: Path) -> dict | None:
    merged = merge_exclusive_dirs(dirs, media_root)
    if not merged:
        return None
    key = _subsection_key(label)
    return {
        "key": key,
        "label": label,
        "items": list(merged.get("items") or []),
        "subsections": list(merged.get("subsections") or []),
    }


def build_exclusive_with_people(
    people: list[tuple[str, list[Path]]],
    media_root: Path,
) -> dict | None:
    """Build Exclusive section with optional ``people`` tabs.

    ``people`` is ordered (label, exclusive dirs). Empty people are dropped.
    When only one person remains, ``people`` is omitted and items/subsections
    flatten to that person (existing UI). When two or more, ``people`` is set.
    """
    entries: list[dict] = []
    seen_keys: set[str] = set()
    for label, dirs in people:
        name = (label or "").strip()
        if not name:
            continue
        key = _subsection_key(name)
        if key in seen_keys:
            continue
        entry = _person_entry(name, dirs, media_root)
        if not entry:
            continue
        # Skip empty (no items and no subsections)
        if not entry.get("items") and not entry.get("subsections"):
            continue
        seen_keys.add(key)
        entries.append(entry)

    if not entries:
        return None

    if len(entries) == 1:
        only = entries[0]
        out: dict = {
            "key": "exclusive",
            "label": "Exclusive",
            "items": list(only.get("items") or []),
        }
        if only.get("subsections"):
            out["subsections"] = only["subsections"]
            out["items"] = []
        return out

    return {
        "key": "exclusive",
        "label": "Exclusive",
        "items": [],
        "people": entries,
    }


def exclusive_people_for_music_band(
    db: Session,
    band,
    media_root: Path,
) -> list[tuple[str, list[Path]]]:
    """Band Exclusive + all-time lineup members (solo → band only)."""
    from app.band_overview import _build_lineup, _is_solo
    from app.gallery import _artist_dir

    people: list[tuple[str, list[Path]]] = []
    band_name = (band.bnd_name or "").strip()
    if band_name:
        leaf_ex = None
        artist_dir = _artist_dir(media_root, band_name)
        if artist_dir:
            leaf_ex = find_exclusive_dir(artist_dir, layout="music")
        dirs = collect_exclusive_dirs_for_person(
            media_root, band_name, leaf_exclusive=leaf_ex
        )
        # Prefer explicit leaf Exclusive once (avoid duplicating music path)
        if leaf_ex and leaf_ex in dirs:
            # music finder also returns leaf_ex — collect already dedupes
            pass
        people.append((band_name, dirs))

    if _is_solo(db, band):
        return people

    lineup = _build_lineup(db, band, media_root)
    for member in lineup.get("all") or []:
        name = (member.get("name") or "").strip()
        if not name:
            continue
        if normalize_person_key(name) == normalize_person_key(band_name):
            continue
        dirs = collect_exclusive_dirs_for_person(media_root, name)
        if dirs:
            people.append((name, dirs))
    return people


def _names_from_cast_blob(cast: dict | None) -> list[str]:
    """Ordered unique names: cast/staff people, then characters, then extras."""
    if not isinstance(cast, dict):
        return []
    out: list[str] = []
    seen: set[str] = set()

    def _add(raw: str | None) -> None:
        name = (raw or "").strip()
        if not name:
            return
        key = normalize_person_key(name)
        if not key or key in seen:
            return
        seen.add(key)
        out.append(name)

    def _from_members(members: list) -> None:
        for m in members:
            if isinstance(m, str):
                _add(m)
                continue
            if not isinstance(m, dict):
                continue
            _add(m.get("name"))
            _add(m.get("character"))
            actor = m.get("actor") or m.get("voice") or m.get("performer")
            if isinstance(actor, str):
                _add(actor)
            elif isinstance(actor, list):
                for a in actor:
                    if isinstance(a, str):
                        _add(a)
                    elif isinstance(a, dict):
                        _add(a.get("name"))
            for key in ("actors", "voices", "people"):
                bucket = m.get(key)
                if isinstance(bucket, list):
                    for a in bucket:
                        if isinstance(a, str):
                            _add(a)
                        elif isinstance(a, dict):
                            _add(a.get("name"))

    # Staff / people first (on-screen / crew order), then characters
    _from_members(list(cast.get("staff") or cast.get("people") or []))
    _from_members(list(cast.get("characters") or cast.get("animated") or []))
    return out


def _split_people_list(raw) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = re.split(r"[;,/|]", raw)
        return [p.strip() for p in parts if p and p.strip()]
    if isinstance(raw, list):
        out: list[str] = []
        for x in raw:
            if isinstance(x, str) and x.strip():
                out.append(x.strip())
            elif isinstance(x, dict) and (x.get("name") or "").strip():
                out.append(str(x.get("name")).strip())
        return out
    return []


def exclusive_people_for_leaf(
    media_root: Path,
    *,
    leaf_dir: Path,
    leaf_title: str,
    cast: dict | None = None,
    writers: list[str] | None = None,
    directors: list[str] | None = None,
    authors: list[str] | None = None,
) -> list[tuple[str, list[Path]]]:
    """Leaf Exclusive first, then cast/staff/writers/directors/characters/authors."""
    people: list[tuple[str, list[Path]]] = []
    title = (leaf_title or leaf_dir.name or "").strip() or leaf_dir.name
    leaf_ex = find_exclusive_dir(leaf_dir, layout="franchise")
    leaf_dirs = collect_exclusive_dirs_for_person(
        media_root, title, leaf_exclusive=leaf_ex
    )
    people.append((title, leaf_dirs))

    ordered_names: list[str] = []
    seen: set[str] = set()

    def _push(name: str | None) -> None:
        n = (name or "").strip()
        if not n:
            return
        key = normalize_person_key(n)
        if not key or key in seen:
            return
        if key == normalize_person_key(title):
            return
        seen.add(key)
        ordered_names.append(n)

    for n in _names_from_cast_blob(cast):
        _push(n)
    for n in _split_people_list(writers):
        _push(n)
    for n in _split_people_list(directors):
        _push(n)
    for n in _split_people_list(authors):
        _push(n)

    for name in ordered_names:
        dirs = collect_exclusive_dirs_for_person(media_root, name)
        if dirs:
            people.append((name, dirs))
    return people


def person_has_any_exclusive(media_root: Path, person_name: str) -> bool:
    return bool(collect_exclusive_dirs_for_person(media_root, person_name))


def _module_from_path(rel: str) -> str | None:
    head = (rel or "").replace("\\", "/").strip("/").split("/", 1)[0].casefold()
    if head in {"series", "movies", "books", "games", "music", "photos"}:
        return head
    return None


def _franchise_name_from_leaf_path(rel: str, module: str) -> str | None:
    """Series/L/Name/... → Name; Movies/L/Name/...; Games/Platform/L/Name/..."""
    parts = [p for p in (rel or "").replace("\\", "/").strip("/").split("/") if p]
    if module == "games":
        # Games/{Platform}/{Letter}/{Franchise}/...
        if len(parts) >= 4:
            return parts[3]
        return None
    # {Module}/{Letter}/{Franchise}/...
    if len(parts) >= 3:
        return parts[2]
    return None


def resolve_leaf_about_context(
    db: Session | None,
    leaf_dir: Path,
    media_root: Path,
) -> dict:
    """Best-effort cast/writers/directors/authors + display title for a leaf folder."""
    from app.franchise_index import parse_dated_folder_name

    rel = ""
    try:
        rel = leaf_dir.relative_to(media_root).as_posix()
    except ValueError:
        rel = leaf_dir.as_posix()
    module = _module_from_path(rel) or "series"
    _, dated_title = parse_dated_folder_name(leaf_dir.name)
    title = (dated_title or leaf_dir.name).strip()
    cast: dict = {}
    writers: list[str] = []
    directors: list[str] = []
    authors: list[str] = []
    franchise = _franchise_name_from_leaf_path(rel, module)

    if db is None:
        return {
            "title": title,
            "cast": cast,
            "writers": writers,
            "directors": directors,
            "authors": authors,
            "module": module,
        }

    try:
        if module == "series" and franchise:
            from app.series_admin import _load_cast
            from app.series_refresh import find_series_row

            row = find_series_row(db, franchise)
            if row:
                cast = _load_cast(row) or {}
                writers = _split_people_list(getattr(row, "ser_writers", None))
        elif module == "movies":
            from app.movies_admin import _load_film_cast, _resolve_film_row
            from app.movies_index import _film_id

            fid = _film_id(rel)
            try:
                _row, _meta, _films, film_meta, _fid, _fdir = _resolve_film_row(
                    db, fid
                )
            except ValueError:
                film_meta = {}
            if isinstance(film_meta, dict) and film_meta:
                cast = _load_film_cast(film_meta) or {}
                writers = _split_people_list(film_meta.get("writers"))
                directors = _split_people_list(film_meta.get("directors"))
        elif module in {"books", "games"}:
            import json

            about: dict = {}
            for name in ("about.json", ".mystack-about.json"):
                about_path = leaf_dir / name
                if about_path.is_file():
                    try:
                        loaded = json.loads(about_path.read_text(encoding="utf-8"))
                        if isinstance(loaded, dict):
                            about = loaded
                            break
                    except (OSError, json.JSONDecodeError):
                        pass
            if isinstance(about.get("cast"), dict):
                cast = about["cast"]
            if module == "books":
                authors = _split_people_list(
                    about.get("authors") or about.get("writers")
                )
                writers = _split_people_list(about.get("writers"))
    except Exception:
        pass

    return {
        "title": title,
        "cast": cast if isinstance(cast, dict) else {},
        "writers": writers,
        "directors": directors,
        "authors": authors,
        "module": module,
    }
