/**
 * Single active dashboard card preview — lightweight, no play stats.
 * Pauses the main player while active and resumes afterward.
 */

export type DashPreviewMainPlayer = {
  pause: () => void;
  resume: () => void;
  getVolume: () => number;
  wasPlaying: () => boolean;
};

let mainPlayer: DashPreviewMainPlayer | null = null;
let pausedByPreview = false;
let sessionHasGesture = false;
let activeToken = 0;
/** True while a dash-card preview is audibly/visually driving beat CSS vars. */
let previewMediaActive = false;
/** Landscape/backdrop URL for the hovered preview card (page atmosphere). */
let previewBackdropUrl: string | null = null;
const backdropListeners = new Set<() => void>();
const hardStopHandlers = new Set<() => void>();

function markGesture() {
  sessionHasGesture = true;
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", markGesture, { passive: true });
  window.addEventListener("keydown", markGesture, { passive: true });
}

export function setDashPreviewMainPlayer(player: DashPreviewMainPlayer | null) {
  mainPlayer = player;
}

export function dashPreviewHasGesture(): boolean {
  return sessionHasGesture;
}

export function setDashPreviewMediaActive(active: boolean) {
  previewMediaActive = Boolean(active);
}

export function isDashPreviewMediaActive(): boolean {
  return previewMediaActive;
}

export function setDashPreviewBackdrop(url: string | null) {
  const next = (url || "").trim() || null;
  if (next === previewBackdropUrl) return;
  previewBackdropUrl = next;
  backdropListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function getDashPreviewBackdrop(): string | null {
  return previewBackdropUrl;
}

export function subscribeDashPreviewBackdrop(fn: () => void): () => void {
  backdropListeners.add(fn);
  return () => {
    backdropListeners.delete(fn);
  };
}

export function beginDashPreview(): number {
  activeToken += 1;
  const token = activeToken;
  if (mainPlayer?.wasPlaying()) {
    mainPlayer.pause();
    pausedByPreview = true;
  } else {
    pausedByPreview = false;
  }
  return token;
}

export function isDashPreviewToken(token: number): boolean {
  return token === activeToken;
}

export function endDashPreview(token: number) {
  if (token !== activeToken) return;
  activeToken += 1;
  previewMediaActive = false;
  setDashPreviewBackdrop(null);
  if (pausedByPreview && mainPlayer) {
    pausedByPreview = false;
    try {
      mainPlayer.resume();
    } catch {
      /* ignore autoplay rejection */
    }
  }
}

export function cancelAllDashPreviews() {
  const token = activeToken;
  endDashPreview(token);
}

/**
 * Instantly kill preview media without resuming the main player.
 * Use when the user activates a card / starts main playback so preview
 * audio cannot overlap the track that is about to play.
 */
export function killDashPreviewsForMainPlay() {
  hardStopHandlers.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
  previewMediaActive = false;
  setDashPreviewBackdrop(null);
  pausedByPreview = false;
  activeToken += 1;
}

export function registerDashPreviewHardStop(fn: () => void): () => void {
  hardStopHandlers.add(fn);
  return () => {
    hardStopHandlers.delete(fn);
  };
}

export function dashPreviewVolume(): number {
  const v = mainPlayer?.getVolume();
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.min(1, Math.max(0, v));
  }
  return 1;
}
