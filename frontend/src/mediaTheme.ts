import {
  applyTheme,
  applyThemeColors,
  getAdaptiveMediaPref,
  getArtistThemeColors,
  getStoredTheme,
  persistThemeChoice,
  readDomTheme,
  readPersistedTheme,
  saveArtistThemeColors,
  setAdaptiveMediaPref,
  type CustomThemeColors,
  type ThemeId,
} from "./themes";

let themeBeforeArtist: ThemeId | null = null;
let artistPageActive = false;
let albumPageActive = false;
/** When set, era/orientation sampling must not override the user's preset theme. */
let artistPageThemePin: ThemeId | null = null;

let playbackSessionActive = false;
let playbackIsPlaying = false;
let themeBeforePlayback: ThemeId | null = null;
/** Exact CSS palette painted before cover sampling (franchise/home page colors). */
let colorsBeforePlayback: CustomThemeColors | null = null;
/** Theme chosen in menu while a playback session is active (shown when paused/stopped). */
let playbackMenuTheme: ThemeId | null = null;
/** When true, cover-based colors must not override the current display while playing. */
let playbackThemeSuppressed = false;
/** Last cover used for playback sampling (re-apply after leaving a leaf page). */
let lastPlaybackCoverUrl: string | null = null;

function readLiveThemeColors(): CustomThemeColors {
  const s = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => {
    const v = s.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    bg: pick("--bg", "#0a0c10"),
    bgElevated: pick("--bg-elevated", "#12151c"),
    bgHover: pick("--bg-hover", "#1a1f28"),
    border: pick("--border", "#2a3042"),
    text: pick("--text", "#e8eaef"),
    textMuted: pick("--text-muted", "#8b93a7"),
    accent: pick("--accent", "#00d4c8"),
  };
}

export function pinArtistPageTheme(id: ThemeId) {
  if (id === "artist" || id === "album") {
    artistPageThemePin = null;
    return;
  }
  artistPageThemePin = id;
}

export function clearArtistPageThemePin() {
  artistPageThemePin = null;
}

function shouldApplySampledTheme(): boolean {
  if (artistPageThemePin) return false;
  if (artistPageActive || albumPageActive) return true;
  const dom = readDomTheme();
  return dom === "artist" || dom === "album";
}

function clamp(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((x) => clamp(x).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: string, b: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return rgbToHex(
    ar + (br - ar) * t,
    ag + (bg - ag) * t,
    ab + (bb - ab) * t
  );
}

function resolveImageSampleUrl(url: string): string {
  if (url.startsWith("/")) {
    return `${window.location.origin}${url}`;
  }
  return url;
}

function sampleColorsFromImage(img: HTMLImageElement): CustomThemeColors | null {
  try {
    const canvas = document.createElement("canvas");
    const size = 32;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 40) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    if (!n) return null;
    const accent = rgbToHex(r / n, g / n, b / n);
    const bg = mix("#050608", accent, 0.35);
    const bgElevated = mix("#0a0c10", accent, 0.28);
    const bgHover = mix("#12151c", accent, 0.22);
    const border = mix("#2a3042", accent, 0.35);
    return {
      bg,
      bgElevated,
      bgHover,
      border,
      text: "#e8eaef",
      textMuted: mix("#8b93a7", accent, 0.15),
      accent,
    };
  } catch {
    return null;
  }
}

export function colorsFromImageUrl(
  url: string
): Promise<CustomThemeColors | null> {
  const fullUrl = resolveImageSampleUrl(url);
  return fetch(fullUrl)
    .then((res) => {
      if (!res.ok) throw new Error("cover fetch failed");
      return res.blob();
    })
    .then(
      (blob) =>
        new Promise<CustomThemeColors | null>((resolve) => {
          const objectUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const colors = sampleColorsFromImage(img);
            URL.revokeObjectURL(objectUrl);
            resolve(colors);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(null);
          };
          img.src = objectUrl;
        })
    )
    .catch(() => null);
}

function applyMediaCss(colors: CustomThemeColors, theme: "artist" | "album" = "artist") {
  const el = document.documentElement;
  el.dataset.theme = theme;
  applyThemeColors(colors);
}

/** Cover-based playback colors without changing the menu theme indicator. */
function applyPlaybackCoverColors(colors: CustomThemeColors) {
  applyThemeColors(colors);
}

function clearMediaCss() {
  const el = document.documentElement;
  delete el.dataset.theme;
  const keys = [
    "--bg",
    "--bg-elevated",
    "--bg-hover",
    "--border",
    "--text",
    "--text-muted",
    "--accent",
    "--accent-hover",
    "--accent-fg",
    "--scrollbar-thumb",
    "--scrollbar-track",
  ];
  keys.forEach((k) => el.style.removeProperty(k));
}

function restoreThemeAfterPlayback(userId?: number) {
  const restore =
    playbackMenuTheme ?? themeBeforePlayback ?? readPersistedTheme(userId);
  if (artistPageActive) {
    if (playbackMenuTheme || playbackThemeSuppressed) {
      if (restore === "artist") {
        const colors = colorsBeforePlayback || getArtistThemeColors(userId);
        if (colors) applyMediaCss(colors);
        else applyTheme("artist", userId);
      } else {
        clearMediaCss();
        applyTheme(restore, userId);
      }
      window.dispatchEvent(new CustomEvent("theme-changed"));
      return;
    }
    // Prefer the exact pre-play snapshot (Series/Movies/Books/Games home +
    // franchise pages). Stored artist colors can be stale or from Music.
    const colors =
      colorsBeforePlayback || getArtistThemeColors(userId) || null;
    if (colors) {
      applyMediaCss(colors, albumPageActive ? "album" : "artist");
      window.dispatchEvent(new CustomEvent("theme-changed"));
    } else {
      clearMediaCss();
      applyTheme(restore === "artist" || restore === "album" ? "dark" : restore, userId);
    }
    window.dispatchEvent(new CustomEvent("playback-theme-ended"));
    return;
  }
  if (colorsBeforePlayback) {
    // Home chrome may still carry adaptive CSS vars from a prior media page.
    applyThemeColors(colorsBeforePlayback);
    window.dispatchEvent(new CustomEvent("theme-changed"));
    window.dispatchEvent(new CustomEvent("playback-theme-ended"));
    return;
  }
  clearMediaCss();
  applyTheme(restore, userId);
  window.dispatchEvent(new CustomEvent("playback-theme-ended"));
}

function storedBaseTheme(userId?: number): ThemeId {
  const stored = readPersistedTheme(userId);
  if (stored === "artist" || stored === "album") return "dark";
  return stored;
}

/** True while an artist or release page owns the Adaptive theme session. */
export function isMediaPageThemeSessionActive() {
  return artistPageActive || albumPageActive;
}

/** Call when entering a page that samples theme colors from media art. */
export function beginArtistPageSession(userId?: number) {
  if (!artistPageActive) {
    themeBeforeArtist = storedBaseTheme(userId);
    artistPageActive = true;
  }
  // Home theme picks must not stick — Adaptive is always active on entry.
  clearArtistPageThemePin();
  setAdaptiveMediaPref(true, userId);
  const colors = getArtistThemeColors(userId);
  if (colors) {
    applyMediaCss(colors);
  } else {
    applyTheme("artist", userId);
  }
  document.documentElement.setAttribute("data-theme", "artist");
  window.dispatchEvent(new CustomEvent("theme-changed"));
}

/** Apply stored theme unless a media page is currently sampling Adaptive. */
export function applyStoredThemeOrKeepAdaptive(userId: number) {
  if ((artistPageActive || albumPageActive) && !artistPageThemePin) {
    return;
  }
  applyTheme(getStoredTheme(userId), userId);
}

/** Album/release pages use the same adaptive sampling session as artist pages. */
export function beginAdaptivePageSession(userId?: number) {
  beginArtistPageSession(userId);
  beginAlbumPageSession();
}

/** True while cover sampling is actively painting (playing only — not paused). */
export function isPlaybackThemeActive() {
  return playbackSessionActive && playbackIsPlaying;
}

export function isPlaybackSessionActive() {
  return playbackSessionActive;
}

export function isPlaybackPlaying() {
  return playbackIsPlaying;
}

/** Theme id shown in the menu (persisted choice during playback, not cover sampling). */
export function getMenuActiveTheme(userId?: number): ThemeId {
  if (playbackSessionActive) {
    if (playbackMenuTheme) return playbackMenuTheme;
    // Keep Adaptive selected in the menu while cover sampling is active.
    if (
      !playbackThemeSuppressed &&
      !artistPageThemePin &&
      (artistPageActive || albumPageActive)
    ) {
      return "artist";
    }
    return readPersistedTheme(userId);
  }
  if (!artistPageThemePin && (artistPageActive || albumPageActive)) {
    return "artist";
  }
  const dom = readDomTheme();
  if (dom === "album") return "artist";
  return dom;
}

export function isAdaptiveThemeActive(): boolean {
  if (artistPageThemePin) return false;
  const dom = readDomTheme();
  return dom === "artist" || dom === "album";
}

export function setPlaybackPlaying(playing: boolean) {
  playbackIsPlaying = playing;
}

function beginPlaybackThemeSession(userId?: number) {
  if (!playbackSessionActive) {
    themeBeforePlayback = readPersistedTheme(userId);
    colorsBeforePlayback = readLiveThemeColors();
    playbackMenuTheme = null;
    playbackThemeSuppressed = false;
  }
  playbackSessionActive = true;
}

/** Sample cover art and override theme colors while a track is actively playing. */
export function applyPlaybackThemeFromCover(
  coverUrl: string | null | undefined,
  userId?: number
) {
  if (!coverUrl || artistPageThemePin || playbackThemeSuppressed) return;
  lastPlaybackCoverUrl = coverUrl;
  beginPlaybackThemeSession(userId);
  void colorsFromImageUrl(coverUrl).then((colors) => {
    if (
      !colors ||
      !playbackSessionActive ||
      !playbackIsPlaying ||
      playbackThemeSuppressed
    ) {
      return;
    }
    if (artistPageActive) {
      applyMediaCss(colors, "artist");
      window.dispatchEvent(new CustomEvent("theme-changed"));
    } else {
      applyPlaybackCoverColors(colors);
      window.dispatchEvent(new CustomEvent("playback-cover-applied"));
    }
  });
}

/** User picked a theme in the menu while audio is still playing. */
export function notifyUserThemePickDuringPlayback(
  id: ThemeId,
  userId?: number
): boolean {
  if (!playbackSessionActive || !playbackIsPlaying) return false;
  playbackThemeSuppressed = true;
  playbackMenuTheme = id;
  persistThemeChoice(id, userId);
  if (artistPageActive) pinArtistPageTheme(id);
  return true;
}

/** User picked a theme while paused but a track is still loaded. */
export function notifyUserThemePickWhilePaused(
  id: ThemeId,
  userId?: number
) {
  if (!playbackSessionActive) return;
  playbackMenuTheme = id;
  playbackThemeSuppressed = true;
  persistThemeChoice(id, userId);
}

export function onPlaybackPaused(userId?: number) {
  if (!playbackSessionActive) return;
  playbackIsPlaying = false;
  // Keep Adaptive / cover sampling while on a media leaf page (e.g. release
  // opened from home via Lyrics). Pausing on module home restores the menu theme.
  if (
    (artistPageActive || albumPageActive) &&
    !playbackThemeSuppressed &&
    !artistPageThemePin
  ) {
    return;
  }
  restoreThemeAfterPlayback(userId);
}

export function onPlaybackResumed(
  coverUrl: string | null | undefined,
  userId?: number
) {
  if (!playbackSessionActive) return;
  playbackIsPlaying = true;
  playbackThemeSuppressed = false;
  clearArtistPageThemePin();
  applyPlaybackThemeFromCover(coverUrl, userId);
}

/** Restore theme when playback stops or the loaded track is cleared. */
export function endPlaybackThemeSession(userId?: number) {
  if (!playbackSessionActive) return;
  playbackSessionActive = false;
  playbackIsPlaying = false;
  lastPlaybackCoverUrl = null;
  restoreThemeAfterPlayback(userId);
  themeBeforePlayback = null;
  colorsBeforePlayback = null;
  playbackMenuTheme = null;
  playbackThemeSuppressed = false;
}

export function applyMediaTheme(colors: CustomThemeColors, userId?: number) {
  // Media leaf pages (release / artist) own Adaptive while open — don't let
  // an active playback session block their cover sampling.
  if (
    playbackSessionActive &&
    playbackIsPlaying &&
    !artistPageActive &&
    !albumPageActive
  ) {
    window.dispatchEvent(new CustomEvent("artist-theme-updated"));
    return;
  }
  saveArtistThemeColors(colors, userId);
  if (shouldApplySampledTheme()) {
    const variant: "artist" | "album" = albumPageActive ? "album" : "artist";
    applyMediaCss(colors, variant);
    window.dispatchEvent(new CustomEvent("theme-changed"));
  }
  window.dispatchEvent(new CustomEvent("artist-theme-updated"));
}

/** Call when entering a release page (artist session should stay active). */
export function beginAlbumPageSession() {
  albumPageActive = true;
}

export function applyAlbumTheme(colors: CustomThemeColors) {
  applyMediaCss(colors, "album");
  window.dispatchEvent(new CustomEvent("theme-changed"));
  window.dispatchEvent(new CustomEvent("artist-theme-updated"));
}

export function clearAlbumTheme(userId?: number) {
  if (!albumPageActive) return;
  albumPageActive = false;
  if (artistPageActive) {
    const colors = getArtistThemeColors(userId);
    if (colors) {
      applyMediaCss(colors);
      window.dispatchEvent(new CustomEvent("theme-changed"));
      return;
    }
    clearMediaCss();
    applyTheme("artist", userId);
    window.dispatchEvent(new CustomEvent("theme-changed"));
    return;
  }
  clearMediaCss();
  applyTheme(readPersistedTheme(userId), userId);
  window.dispatchEvent(new CustomEvent("theme-changed"));
}

/**
 * Leave a user/local/snapshot playlist page back to Music module chrome.
 * Always restores the user's menu theme (never leaves album/artist sampling active).
 */
export function clearUserPlaylistPageTheme(userId?: number) {
  albumPageActive = false;
  artistPageActive = false;
  themeBeforeArtist = null;
  clearArtistPageThemePin();
  clearMediaCss();
  applyTheme(readPersistedTheme(userId), userId);
  window.dispatchEvent(new CustomEvent("theme-changed"));
}

export function applySavedArtistTheme(userId?: number) {
  const colors = getArtistThemeColors(userId);
  if (colors) {
    applyMediaCss(colors);
    window.dispatchEvent(new CustomEvent("theme-changed"));
  }
}

export function clearMediaTheme(userId?: number) {
  albumPageActive = false;
  clearArtistPageThemePin();
  // Leaving a leaf/franchise/universe must always restore the home/menu theme.
  // If module home audio is still playing, re-apply cover sampling afterward so
  // the accent stays — but never leave leaf CSS vars stuck on home chrome.
  const keepPlaybackCover = playbackSessionActive && playbackIsPlaying;
  const restore = themeBeforeArtist ?? readPersistedTheme(userId);
  themeBeforeArtist = null;
  artistPageActive = false;
  if (!keepPlaybackCover) {
    endPlaybackThemeSession(userId);
  }
  clearMediaCss();
  applyTheme(restore, userId);
  if (keepPlaybackCover && lastPlaybackCoverUrl) {
    // Pause-on-home must restore the menu theme, not leaf Adaptive colors
    // captured when playback started on a release/artist page.
    themeBeforePlayback = restore;
    colorsBeforePlayback = readLiveThemeColors();
    applyPlaybackThemeFromCover(lastPlaybackCoverUrl, userId);
  }
}

/** Snapshot theme before Switch Profile so Back can restore leaf Adaptive. */
let themeBeforeProfileSwitch: {
  artistPageActive: boolean;
  albumPageActive: boolean;
  themeBeforeArtist: ThemeId | null;
  colors: CustomThemeColors | null;
} | null = null;

export function beginProfileSwitchTheme(userId?: number) {
  themeBeforeProfileSwitch = {
    artistPageActive,
    albumPageActive,
    themeBeforeArtist,
    colors: artistPageActive || albumPageActive ? readLiveThemeColors() : null,
  };
  // Profile picker always uses the stored home/menu theme.
  albumPageActive = false;
  artistPageActive = false;
  themeBeforeArtist = null;
  clearArtistPageThemePin();
  if (!(playbackSessionActive && playbackIsPlaying)) {
    endPlaybackThemeSession(userId);
  }
  clearMediaCss();
  applyTheme(readPersistedTheme(userId), userId);
}

export function endProfileSwitchTheme(userId?: number) {
  const snap = themeBeforeProfileSwitch;
  themeBeforeProfileSwitch = null;
  if (!snap) {
    applyStoredThemeOrKeepAdaptive(userId ?? 0);
    return;
  }
  if (snap.artistPageActive || snap.albumPageActive) {
    artistPageActive = snap.artistPageActive;
    albumPageActive = snap.albumPageActive;
    themeBeforeArtist = snap.themeBeforeArtist;
    clearArtistPageThemePin();
    setAdaptiveMediaPref(true, userId);
    if (snap.colors) {
      applyMediaCss(snap.colors, snap.albumPageActive ? "album" : "artist");
    } else {
      applyTheme("artist", userId);
    }
    document.documentElement.setAttribute(
      "data-theme",
      snap.albumPageActive ? "album" : "artist"
    );
    window.dispatchEvent(new CustomEvent("theme-changed"));
    return;
  }
  clearMediaCss();
  applyTheme(readPersistedTheme(userId), userId);
}
