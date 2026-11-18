"""Module activity recording + Wrapped for non-music stacks."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, get_nsfw_unlocked
from app.models import User
from app.module_activity import MODULES, build_module_wrapped, record_module_activity

router = APIRouter(prefix="/api/activity", tags=["activity"])


class ActivityRecordIn(BaseModel):
    module: str
    entity_kind: str
    entity_id: str
    title: str | None = None
    path: str | None = None
    franchise_id: str | None = None
    franchise_title: str | None = None
    cover_url: str | None = None
    group_id: str | None = None
    group_title: str | None = None
    vibe_key: str | None = None
    vibe_label: str | None = None


@router.post("/record")
def activity_record(
    body: ActivityRecordIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mod = (body.module or "").strip().casefold()
    if mod not in MODULES:
        raise HTTPException(status_code=400, detail="Unknown module")
    row = record_module_activity(
        db,
        user_id=user.usr_id,
        module=mod,
        entity_kind=body.entity_kind,
        entity_id=body.entity_id,
        title=body.title,
        path=body.path,
        franchise_id=body.franchise_id,
        franchise_title=body.franchise_title,
        cover_url=body.cover_url,
        group_id=body.group_id,
        group_title=body.group_title,
        vibe_key=body.vibe_key,
        vibe_label=body.vibe_label,
    )
    if row is None:
        raise HTTPException(status_code=400, detail="Could not record activity")
    return {"ok": True, "count": int(row.mad_count or 1)}


@router.get("/wrapped")
def activity_wrapped(
    module: str = Query(..., min_length=1),
    year: int | None = Query(None, ge=2000, le=2100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    nsfw_unlocked: bool = Depends(get_nsfw_unlocked),
):
    mod = module.strip().casefold()
    if mod not in MODULES:
        raise HTTPException(status_code=400, detail="Unknown module")
    return build_module_wrapped(
        db, user.usr_id, mod, year=year, nsfw_unlocked=nsfw_unlocked
    )
