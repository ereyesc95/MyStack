import { useMemo, useState } from "react";
import {
  patchUniverse,
  pickUniverseMediaImage,
  pullUniverseTmdbPortrait,
  unlinkUniverseMember,
} from "../api";
import { withMediaAccess } from "../mediaFileUrl";
import type { Universe, UniverseCard } from "../types";
import ArtPickSquare from "./ArtPickSquare";
import ConfirmDialog from "./ConfirmDialog";
import ModalPortal from "./ModalPortal";

type Props = {
  universe: Universe;
  members?: UniverseCard[];
  onClose: () => void;
  onSaved: (next: Universe) => void;
  onMembersChanged?: () => void;
};

const ART_KINDS = ["Portrait", "Landscape", "Banner", "Logo"] as const;

function artUrl(
  u: Universe,
  kind: (typeof ART_KINDS)[number]
): string | null {
  const url =
    kind === "Portrait"
      ? u.portrait_url || u.cover_url
      : kind === "Landscape"
        ? u.landscape_url
        : kind === "Banner"
          ? u.banner_url
          : u.logo_url;
  return url ? withMediaAccess(url) : null;
}

function memberKey(m: UniverseCard): string {
  return `${m.module}:${m.franchise_id}:${m.leaf_id || m.id || ""}`;
}

function memberTitle(m: UniverseCard): string {
  return (m.title || m.name || m.leaf_id || m.franchise_id || "Member").trim();
}

function memberCoverUrl(m: UniverseCard): string | null {
  const url =
    m.portrait_url || m.cover_url || m.landscape_url || m.banner_url || null;
  return url ? withMediaAccess(url) : null;
}

export default function UniverseAboutEditModal({
  universe,
  members: membersProp = [],
  onClose,
  onSaved,
  onMembersChanged,
}: Props) {
  const [name, setName] = useState(universe.name || "");
  const [overview, setOverview] = useState(universe.overview || "");
  const [artPicks, setArtPicks] = useState<
    Partial<
      Record<(typeof ART_KINDS)[number], { path: string; url: string | null }>
    >
  >({});
  const [members, setMembers] = useState<UniverseCard[]>(membersProp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(universe);
  const [removeTarget, setRemoveTarget] = useState<UniverseCard | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const sortedMembers = useMemo(
    () =>
      [...members].sort((a, b) =>
        memberTitle(a).localeCompare(memberTitle(b), undefined, {
          sensitivity: "base",
        })
      ),
    [members]
  );

  async function browseArt(kind: (typeof ART_KINDS)[number]) {
    setBusy(true);
    setError(null);
    try {
      const picked = await pickUniverseMediaImage(kind);
      if (picked.cancelled || !picked.path) return;
      setArtPicks((prev) => ({
        ...prev,
        [kind]: { path: picked.path!, url: picked.url },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await patchUniverse(universe.id, {
        name: trimmed,
        overview: overview.trim() || null,
        ...(artPicks.Portrait
          ? { portrait_path: artPicks.Portrait.path }
          : {}),
        ...(artPicks.Landscape
          ? { landscape_path: artPicks.Landscape.path }
          : {}),
        ...(artPicks.Banner ? { banner_path: artPicks.Banner.path } : {}),
        ...(artPicks.Logo ? { logo_path: artPicks.Logo.path } : {}),
      });
      setCurrent(next);
      onSaved(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchPortrait() {
    setBusy(true);
    setError(null);
    try {
      const next = await pullUniverseTmdbPortrait(universe.id);
      setCurrent(next);
      onSaved(next);
      setArtPicks((prev) => {
        const { Portrait: _drop, ...rest } = prev;
        return rest;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    const mod = removeTarget.module;
    if (
      mod !== "movies" &&
      mod !== "series" &&
      mod !== "books" &&
      mod !== "games"
    ) {
      setRemoveError("Unknown member type.");
      return;
    }
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await unlinkUniverseMember(
        universe.id,
        mod,
        removeTarget.franchise_id,
        removeTarget.leaf_id || removeTarget.id || null
      );
      const key = memberKey(removeTarget);
      setMembers((prev) => prev.filter((m) => memberKey(m) !== key));
      setRemoveTarget(null);
      onMembersChanged?.();
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <>
      <ModalPortal onClose={onClose}>
        <div
          className="modal-panel artist-admin-modal add-universe-modal"
          role="dialog"
          aria-modal
          aria-labelledby="universe-about-edit-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="modal-panel-header">
            <h3 id="universe-about-edit-title">Update universe</h3>
            <button
              type="button"
              className="modal-close-x"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="artist-admin-form">
            <label className="artist-admin-form__inline">
              <span className="artist-admin-form__inline-label">Name</span>
              <input
                className="artist-admin-form__inline-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </label>
            <label className="artist-admin-form__inline artist-admin-form__inline--top">
              <span className="artist-admin-form__inline-label">Overview</span>
              <textarea
                className="artist-admin-form__inline-field"
                value={overview}
                onChange={(e) => setOverview(e.target.value)}
                rows={6}
                disabled={busy}
                placeholder="Optional"
              />
            </label>
            <div
              className="add-universe-modal__art-row"
              role="group"
              aria-label="Universe artwork"
            >
              {ART_KINDS.map((kind) => (
                <ArtPickSquare
                  key={kind}
                  label={kind.toLowerCase()}
                  previewUrl={
                    artPicks[kind]?.url
                      ? withMediaAccess(artPicks[kind]!.url!)
                      : artUrl(current, kind)
                  }
                  objectFit={kind === "Logo" ? "contain" : "cover"}
                  disabled={busy}
                  onBrowseMedia={() => void browseArt(kind)}
                />
              ))}
            </div>
            <div className="add-universe-modal__members">
              <span className="add-universe-modal__members-label">Members</span>
              {sortedMembers.length === 0 ? (
                <p className="add-universe-modal__members-empty muted">
                  No members yet.
                </p>
              ) : (
                <ul className="add-universe-modal__member-minis" role="list">
                  {sortedMembers.map((m) => {
                    const title = memberTitle(m);
                    const cover = memberCoverUrl(m);
                    return (
                      <li key={memberKey(m)}>
                        <div
                          className="add-universe-modal__member-mini"
                          title={title}
                        >
                          {cover ? (
                            <img
                              className="add-universe-modal__member-mini-img"
                              src={cover}
                              alt=""
                              draggable={false}
                            />
                          ) : (
                            <span
                              className="add-universe-modal__member-mini-fallback"
                              aria-hidden
                            >
                              {title.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <button
                            type="button"
                            className="add-universe-modal__member-mini-x"
                            disabled={busy || removeBusy}
                            onClick={() => {
                              setRemoveError(null);
                              setRemoveTarget(m);
                            }}
                            aria-label={`Remove ${title} from universe`}
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {error ? <p className="error">{error}</p> : null}
          </div>
          <div className="modal-panel-actions modal-panel-actions--end add-universe-modal__actions">
            <button
              type="button"
              className="btn btn--small"
              disabled={busy}
              onClick={() => void fetchPortrait()}
            >
              Fetch portrait
            </button>
            <button
              type="button"
              className="btn btn--small btn--primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </ModalPortal>

      {removeTarget ? (
        <ConfirmDialog
          title="Remove member?"
          message={`Remove “${memberTitle(removeTarget)}” from this universe?`}
          confirmLabel={removeBusy ? "Removing…" : "Remove"}
          destructive
          hideCancel
          busy={removeBusy}
          error={removeError}
          onConfirm={() => void confirmRemove()}
          onClose={() => {
            if (removeBusy) return;
            setRemoveTarget(null);
            setRemoveError(null);
          }}
        />
      ) : null}
    </>
  );
}
