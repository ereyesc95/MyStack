"""Resolve optional country banner/landscape art under assets/countries/."""
from __future__ import annotations

import re
from pathlib import Path

from app.paths import PROJECT_ROOT

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
COUNTRIES_DIR = PROJECT_ROOT / "assets" / "countries"
ORIENTATIONS = ("banner", "landscape", "square", "portrait")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").casefold())


def _stem_parts(stem: str) -> tuple[str, str | None]:
    """Return (country_key, orientation|None) from a filename stem."""
    raw = stem.strip()
    low = raw.casefold()
    for ori in ORIENTATIONS:
        for sep in (" - ", " – ", " — ", "-", "_"):
            suffix = f"{sep}{ori}"
            if low.endswith(suffix):
                base = raw[: -len(suffix)].strip()
                return base, ori
    return raw, None


def resolve_country_art(name: str) -> dict[str, str | None]:
    """Pick country art URLs: banner → landscape → bare name → None."""
    out: dict[str, str | None] = {
        "banner_url": None,
        "landscape_url": None,
        "cover_url": None,
    }
    if not name or not COUNTRIES_DIR.is_dir():
        return out

    want = _norm(name)
    by_ori: dict[str, Path] = {}
    bare: Path | None = None

    try:
        files = list(COUNTRIES_DIR.iterdir())
    except OSError:
        return out

    for f in files:
        if not f.is_file() or f.suffix.lower() not in IMAGE_EXTS:
            continue
        base, ori = _stem_parts(f.stem)
        if _norm(base) != want:
            continue
        if ori:
            by_ori.setdefault(ori, f)
        elif bare is None:
            bare = f

    def _url(path: Path | None) -> str | None:
        if not path:
            return None
        return f"/api/assets/countries/{path.name}"

    out["banner_url"] = _url(by_ori.get("banner"))
    out["landscape_url"] = _url(
        by_ori.get("landscape") or by_ori.get("square") or by_ori.get("portrait")
    )
    out["cover_url"] = _url(bare)
    return out


def with_country_art(row: dict) -> dict:
    """Merge country asset URLs onto a dashboard country dict (mutates + returns)."""
    name = str(row.get("name") or "")
    art = resolve_country_art(name)
    row["banner_url"] = art.get("banner_url")
    row["landscape_url"] = art.get("landscape_url")
    row["cover_url"] = art.get("cover_url")
    return row
