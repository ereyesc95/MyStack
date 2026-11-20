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

export function dashPreviewVolume(): number {
  const v = mainPlayer?.getVolume();
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.min(1, Math.max(0, v));
  }
  return 1;
}
