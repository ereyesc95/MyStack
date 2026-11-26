/**
 * Bridge: global music bar → release tracklist lyrics / versions panels.
 * ReleasePage consumes the pending action when the matching release is open.
 * A second click on the same action toggles back to the prior route.
 */

export type ReleasePlayerAction = "lyrics" | "versions";

export type ReleasePlayerActionRequest = {
  action: ReleasePlayerAction;
  bandId: number;
  releaseId: string;
  trackPath: string;
  trackTitle?: string | null;
};

let pending: ReleasePlayerActionRequest | null = null;
/** Currently open lyrics/versions panel from the global bar (for active chrome). */
let active: ReleasePlayerActionRequest | null = null;
/** Route to restore when toggling the active action off. */
let returnHref: string | null = null;

const listeners = new Set<() => void>();
const activeListeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function notifyActive() {
  activeListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function sameReq(
  a: ReleasePlayerActionRequest | null,
  b: ReleasePlayerActionRequest
): boolean {
  if (!a) return false;
  return (
    a.action === b.action &&
    a.bandId === b.bandId &&
    a.releaseId === b.releaseId &&
    a.trackPath === b.trackPath
  );
}

/**
 * Open lyrics/versions, or close + restore prior route if already active
 * for the same action/track.
 */
function pathLooksLikeRelease(req: ReleasePlayerActionRequest): boolean {
  const path = window.location.pathname.toLowerCase();
  const rid = String(req.releaseId || "").toLowerCase();
  if (!rid) return false;
  // Slug or id segment, or any artist audio release URL.
  if (path.includes(rid)) return true;
  if (path.includes("/audio/") && /\/(overview|tracklist|gallery)?\/?$/.test(path)) {
    return true;
  }
  return /\/audio\/[^/]+/.test(path);
}

export function toggleReleasePlayerAction(
  req: ReleasePlayerActionRequest
): "opened" | "closed" {
  if (sameReq(active, req) && pathLooksLikeRelease(req)) {
    const href = returnHref;
    pending = null;
    active = null;
    returnHref = null;
    notify();
    notifyActive();
    if (href != null) {
      window.dispatchEvent(
        new CustomEvent("mystack-restore-route", { detail: { href } })
      );
    }
    return "closed";
  }
  // Switching lyrics ↔ versions on same track: replace without new return.
  if (
    active &&
    active.bandId === req.bandId &&
    active.releaseId === req.releaseId &&
    active.trackPath === req.trackPath
  ) {
    pending = req;
    active = req;
    notify();
    notifyActive();
    return "opened";
  }
  returnHref =
    window.location.pathname +
    window.location.search +
    window.location.hash;
  pending = req;
  active = req;
  notify();
  notifyActive();
  return "opened";
}

export function requestReleasePlayerAction(req: ReleasePlayerActionRequest) {
  toggleReleasePlayerAction(req);
}

export function peekReleasePlayerAction(): ReleasePlayerActionRequest | null {
  return pending;
}

export function consumeReleasePlayerAction(
  bandId?: number | null,
  _releaseId?: string | null
): ReleasePlayerActionRequest | null {
  if (!pending) return null;
  // Band match is enough: ReleasePage is one release; ids may be slug vs path.
  if (bandId != null && pending.bandId !== bandId) return null;
  const out = pending;
  pending = null;
  return out;
}

/** Match without consuming — used while waiting for tracklist to mount. */
export function matchReleasePlayerAction(
  bandId?: number | null,
  _releaseId?: string | null
): ReleasePlayerActionRequest | null {
  if (!pending) return null;
  if (bandId != null && pending.bandId !== bandId) return null;
  return pending;
}

export function getActiveReleasePlayerAction(): ReleasePlayerActionRequest | null {
  return active;
}

export function markReleasePlayerActionActive(req: ReleasePlayerActionRequest) {
  active = req;
  notifyActive();
}

export function clearReleasePlayerActionActive() {
  if (!active && !returnHref && !pending) return;
  pending = null;
  active = null;
  returnHref = null;
  notify();
  notifyActive();
}

/** True when the current URL looks like the given release. */
export function isOnReleasePlayerRoute(req: {
  bandId: number;
  releaseId: string;
}): boolean {
  return pathLooksLikeRelease({
    action: "lyrics",
    bandId: req.bandId,
    releaseId: req.releaseId,
    trackPath: "",
  });
}

export function subscribeReleasePlayerAction(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function subscribeReleasePlayerActionActive(fn: () => void): () => void {
  activeListeners.add(fn);
  return () => activeListeners.delete(fn);
}
