/**
 * App-wide music player — one audio element, survives module/route changes.
 * Refresh restores queue/position paused (no autoplay).
 */
import { playTrack } from "./api";
import { resumeBeatAudioContext } from "./beatAudioGraph";
import { setDashPreviewMainPlayer } from "./dashPreviewController";
import {
  clearNowPlaying,
  mediaSessionOwnsElement,
  setNowPlaying,
} from "./mediaSession";
import {
  applyPlaybackThemeFromCover,
  endPlaybackThemeSession,
  onPlaybackPaused,
  onPlaybackResumed,
  setPlaybackPlaying,
} from "./mediaTheme";
import { musicStreamUrl } from "./musicStreamUrl";

export type GlobalMusicTrack = {
  /** Stable id for React keys / reorder (defaults to path). */
  id: string;
  path: string;
  title: string;
  artist?: string | null;
  artistId?: number | null;
  releaseId?: string | null;
  releaseTitle?: string | null;
  coverUrl?: string | null;
  /** Optional absolute stream URL; otherwise derived from path. */
  playUrl?: string | null;
};

export type GlobalMusicSnapshot = {
  queue: GlobalMusicTrack[];
  index: number;
  current: GlobalMusicTrack | null;
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
  repeatOne: boolean;
  shuffle: boolean;
  barHidden: boolean;
  queueOpen: boolean;
  hasTrack: boolean;
};

type PersistBlob = {
  queue: GlobalMusicTrack[];
  originalQueue: GlobalMusicTrack[];
  index: number;
  progress: number;
  volume: number;
  repeatOne: boolean;
  shuffle: boolean;
  barHidden: boolean;
};

const STORAGE_KEY = "mystack.globalMusicPlayer.v1";
const listeners = new Set<() => void>();

let audioEl: HTMLAudioElement | null = null;
let queue: GlobalMusicTrack[] = [];
let originalQueue: GlobalMusicTrack[] = [];
let index = -1;
let playing = false;
let progress = 0;
let duration = 0;
let volume = 1;
let repeatOne = false;
let shuffle = false;
let barHidden = false;
let queueOpen = false;
let userId: number | undefined;
let endedHandlerAttached = false;
let restoredPaused = false;

function notify() {
  listeners.forEach((fn) => fn());
}

function currentTrack(): GlobalMusicTrack | null {
  if (index < 0 || index >= queue.length) return null;
  return queue[index] ?? null;
}

function streamUrlFor(track: GlobalMusicTrack): string {
  const direct = (track.playUrl || "").trim();
  if (direct) return direct;
  return musicStreamUrl(track.path);
}

function ensureAudio(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
    audioEl.volume = volume;
    wireAudio(audioEl);
  }
  return audioEl;
}

function wireAudio(el: HTMLAudioElement) {
  if (endedHandlerAttached) return;
  endedHandlerAttached = true;
  el.addEventListener("timeupdate", () => {
    progress = el.currentTime || 0;
    notify();
  });
  el.addEventListener("loadedmetadata", () => {
    duration = el.duration || 0;
    notify();
  });
  el.addEventListener("durationchange", () => {
    duration = el.duration || 0;
    notify();
  });
  el.addEventListener("play", () => {
    playing = true;
    setPlaybackPlaying(true);
    const t = currentTrack();
    onPlaybackResumed(t?.coverUrl ?? null, userId);
    notify();
    persist();
  });
  el.addEventListener("pause", () => {
    playing = false;
    onPlaybackPaused(userId);
    notify();
    persist();
  });
  el.addEventListener("ended", () => {
    void handleEnded();
  });
  el.addEventListener("volumechange", () => {
    volume = el.volume;
    notify();
    persist();
  });
}

function persist() {
  if (typeof sessionStorage === "undefined") return;
  try {
    const blob: PersistBlob = {
      queue,
      originalQueue,
      index,
      progress: audioEl?.currentTime ?? progress,
      volume,
      repeatOne,
      shuffle,
      barHidden,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    /* ignore quota */
  }
}

function loadPersist(): PersistBlob | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistBlob;
  } catch {
    return null;
  }
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Spotify-like: keep current first, shuffle the rest. */
function buildShuffledOrder(
  source: GlobalMusicTrack[],
  currentId: string | null
): GlobalMusicTrack[] {
  if (!source.length) return [];
  if (!currentId) return shuffleInPlace([...source]);
  const cur = source.find((t) => t.id === currentId);
  const rest = source.filter((t) => t.id !== currentId);
  shuffleInPlace(rest);
  return cur ? [cur, ...rest] : rest;
}

function publishSession(track: GlobalMusicTrack, el: HTMLAudioElement) {
  setNowPlaying(
    {
      title: track.title,
      artist: track.artist ?? null,
      album: track.releaseTitle ?? null,
      artworkUrl: track.coverUrl ?? null,
    },
    {
      element: el,
      handlers: {
        play: () => void el.play().catch(() => {}),
        pause: () => el.pause(),
        seekTo: (seconds) => {
          el.currentTime = seconds;
        },
        previous: () => globalMusicPrev(),
        next: () => globalMusicNext(),
      },
    }
  );
}

function reportPlay(track: GlobalMusicTrack) {
  void playTrack({
    path: track.path,
    artist_id: track.artistId ?? undefined,
    title: track.title || undefined,
  }).catch(() => {});
}

async function loadIndex(i: number, autoPlay: boolean) {
  const el = ensureAudio();
  if (!el) return;
  if (i < 0 || i >= queue.length) {
    clearPlayback(true);
    return;
  }
  index = i;
  const track = queue[i];
  const url = streamUrlFor(track);
  resumeBeatAudioContext();
  el.src = url;
  publishSession(track, el);
  applyPlaybackThemeFromCover(track.coverUrl ?? null, userId);
  reportPlay(track);
  notify();
  persist();
  if (autoPlay) {
    try {
      await el.play();
    } catch {
      /* autoplay blocked */
    }
  }
}

async function handleEnded() {
  const el = ensureAudio();
  if (!el) return;
  if (repeatOne && index >= 0) {
    el.currentTime = 0;
    void el.play().catch(() => {});
    return;
  }
  if (index + 1 < queue.length) {
    await loadIndex(index + 1, true);
    return;
  }
  // End of queue: if shuffle on, reshuffle and continue; else clear.
  if (shuffle && originalQueue.length > 1) {
    const justId = currentTrack()?.id ?? null;
    queue = buildShuffledOrder(originalQueue, null);
    // Prefer not starting on the track that just ended.
    if (justId && queue.length > 1 && queue[0]?.id === justId) {
      const first = queue.shift()!;
      queue.push(first);
    }
    index = 0;
    await loadIndex(0, true);
    return;
  }
  clearPlayback(true);
}

function clearPlayback(clearStorage: boolean) {
  const el = audioEl;
  if (el) {
    el.pause();
    el.removeAttribute("src");
    try {
      el.load();
    } catch {
      /* ignore */
    }
    if (mediaSessionOwnsElement(el)) clearNowPlaying();
  }
  queue = [];
  originalQueue = [];
  index = -1;
  playing = false;
  progress = 0;
  duration = 0;
  queueOpen = false;
  setPlaybackPlaying(false);
  endPlaybackThemeSession(userId);
  notify();
  if (clearStorage && typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  } else {
    persist();
  }
}

function normalizeTracks(tracks: GlobalMusicTrack[]): GlobalMusicTrack[] {
  const out: GlobalMusicTrack[] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    const path = (t.path || "").trim();
    if (!path && !(t.playUrl || "").trim()) continue;
    const id = (t.id || path || t.playUrl || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      ...t,
      id,
      path: path || id,
      title: (t.title || "Track").trim() || "Track",
    });
  }
  return out;
}

export function getGlobalMusicSnapshot(): GlobalMusicSnapshot {
  const cur = currentTrack();
  return {
    queue: queue.slice(),
    index,
    current: cur,
    playing,
    progress,
    duration,
    volume,
    repeatOne,
    shuffle,
    barHidden,
    queueOpen,
    hasTrack: Boolean(cur),
  };
}

export function subscribeGlobalMusic(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setGlobalMusicUserId(id: number | undefined) {
  userId = id;
}

/** Play from clicked track through the rest of the list (locked 4b). */
export function globalMusicPlayFrom(
  tracks: GlobalMusicTrack[],
  startIndex: number,
  opts?: { autoPlay?: boolean }
) {
  const list = normalizeTracks(tracks);
  if (!list.length) return;
  const start = Math.max(0, Math.min(startIndex, list.length - 1));
  // From clicked track onward
  const onward = list.slice(start);
  originalQueue = onward.slice();
  if (shuffle) {
    queue = buildShuffledOrder(originalQueue, onward[0]?.id ?? null);
  } else {
    queue = originalQueue.slice();
  }
  index = 0;
  queueOpen = false;
  void loadIndex(0, opts?.autoPlay !== false);
}

/** Replace queue with full list and start at index (used when reshuffling context). */
export function globalMusicPlayList(
  tracks: GlobalMusicTrack[],
  startIndex = 0,
  opts?: { autoPlay?: boolean }
) {
  const list = normalizeTracks(tracks);
  if (!list.length) return;
  const start = Math.max(0, Math.min(startIndex, list.length - 1));
  originalQueue = list.slice();
  const currentId = list[start]?.id ?? null;
  queue = shuffle
    ? buildShuffledOrder(originalQueue, currentId)
    : originalQueue.slice();
  index = shuffle ? 0 : start;
  void loadIndex(index, opts?.autoPlay !== false);
}

export function globalMusicToggle() {
  const el = ensureAudio();
  if (!el || !currentTrack()) return;
  if (el.paused) {
    resumeBeatAudioContext();
    void el.play().catch(() => {});
  } else {
    el.pause();
  }
}

export function globalMusicPause() {
  audioEl?.pause();
}

export function globalMusicResume() {
  const el = audioEl;
  if (!el || !currentTrack()) return;
  resumeBeatAudioContext();
  void el.play().catch(() => {});
}

export function globalMusicNext() {
  void handleEnded();
}

export function globalMusicPrev() {
  const el = ensureAudio();
  if (!el || !currentTrack()) return;
  if ((el.currentTime || 0) > 3) {
    el.currentTime = 0;
    progress = 0;
    notify();
    return;
  }
  if (index > 0) {
    void loadIndex(index - 1, true);
  } else {
    el.currentTime = 0;
    progress = 0;
    notify();
  }
}

export function globalMusicSeekRatio(ratio: number) {
  const el = ensureAudio();
  if (!el || !duration) return;
  const next = Math.max(0, Math.min(1, ratio)) * duration;
  el.currentTime = next;
  progress = next;
  resumeBeatAudioContext();
  notify();
  persist();
}

export function globalMusicSetVolume(v: number) {
  const next = Math.max(0, Math.min(1, v));
  volume = next;
  const el = ensureAudio();
  if (el) el.volume = next;
  notify();
  persist();
}

export function globalMusicToggleRepeatOne() {
  repeatOne = !repeatOne;
  notify();
  persist();
}

export function globalMusicToggleShuffle() {
  const cur = currentTrack();
  shuffle = !shuffle;
  if (!originalQueue.length && queue.length) {
    originalQueue = queue.slice();
  }
  if (shuffle) {
    queue = buildShuffledOrder(originalQueue, cur?.id ?? null);
    index = 0;
  } else if (cur) {
    queue = originalQueue.slice();
    index = Math.max(
      0,
      queue.findIndex((t) => t.id === cur.id)
    );
  }
  notify();
  persist();
}

export function globalMusicReorder(from: number, to: number) {
  if (
    from < 0 ||
    to < 0 ||
    from >= queue.length ||
    to >= queue.length ||
    from === to
  ) {
    return;
  }
  const curId = currentTrack()?.id ?? null;
  const next = queue.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  queue = next;
  if (curId) {
    index = queue.findIndex((t) => t.id === curId);
  }
  // Keep originalQueue in sync when not shuffled (edit base order).
  if (!shuffle) {
    originalQueue = queue.slice();
  }
  notify();
  persist();
}

export function globalMusicRemoveAt(i: number) {
  if (i < 0 || i >= queue.length) return;
  const removingCurrent = i === index;
  const removed = queue[i];
  queue = queue.filter((_, idx) => idx !== i);
  originalQueue = originalQueue.filter((t) => t.id !== removed.id);
  if (!queue.length) {
    clearPlayback(true);
    return;
  }
  if (removingCurrent) {
    const nextIndex = Math.min(i, queue.length - 1);
    void loadIndex(nextIndex, playing);
  } else if (i < index) {
    index -= 1;
    notify();
    persist();
  } else {
    notify();
    persist();
  }
}

export function globalMusicClear() {
  clearPlayback(true);
}

export function globalMusicSetBarHidden(hidden: boolean) {
  barHidden = hidden;
  if (hidden) queueOpen = false;
  notify();
  persist();
}

export function globalMusicToggleQueueOpen() {
  queueOpen = !queueOpen;
  if (queueOpen) barHidden = false;
  notify();
}

export function globalMusicSetQueueOpen(open: boolean) {
  queueOpen = open;
  notify();
}

export function getGlobalMusicAudioElement(): HTMLAudioElement | null {
  return ensureAudio();
}

/** Call once from App mount — restore paused session + dash preview bridge. */
export function initGlobalMusicPlayer() {
  ensureAudio();
  setDashPreviewMainPlayer({
    pause: () => globalMusicPause(),
    resume: () => globalMusicResume(),
    getVolume: () => volume,
    wasPlaying: () => Boolean(audioEl && !audioEl.paused && currentTrack()),
  });

  if (restoredPaused) return;
  restoredPaused = true;
  const blob = loadPersist();
  if (!blob?.queue?.length) return;
  queue = normalizeTracks(blob.queue);
  originalQueue = normalizeTracks(blob.originalQueue?.length ? blob.originalQueue : blob.queue);
  index = Math.max(0, Math.min(blob.index ?? 0, queue.length - 1));
  volume = typeof blob.volume === "number" ? blob.volume : 1;
  repeatOne = Boolean(blob.repeatOne);
  shuffle = Boolean(blob.shuffle);
  barHidden = Boolean(blob.barHidden);
  const el = ensureAudio();
  if (!el || !queue[index]) return;
  const track = queue[index];
  el.volume = volume;
  el.src = streamUrlFor(track);
  const seekTo = typeof blob.progress === "number" ? blob.progress : 0;
  const onMeta = () => {
    duration = el.duration || 0;
    try {
      if (seekTo > 0 && Number.isFinite(seekTo)) {
        el.currentTime = Math.min(seekTo, duration || seekTo);
      }
    } catch {
      /* ignore */
    }
    progress = el.currentTime || 0;
    el.removeEventListener("loadedmetadata", onMeta);
    notify();
  };
  el.addEventListener("loadedmetadata", onMeta);
  publishSession(track, el);
  playing = false;
  // Restore paused — user hits play (locked 12c).
  notify();
}
