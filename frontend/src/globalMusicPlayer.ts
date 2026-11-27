/**
 * App-wide music player — one audio element, survives module/route changes.
 * Refresh restores queue/position paused (no autoplay).
 */
import { playTrack } from "./api";
import { resumeBeatAudioContext } from "./beatAudioGraph";
import {
  killDashPreviewsForMainPlay,
  setDashPreviewMainPlayer,
} from "./dashPreviewController";
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

export type GlobalMusicQueuedBy = "next" | "last";

export type GlobalMusicTrack = {
  /** Stable id for React keys / reorder (defaults to path). */
  id: string;
  path: string;
  title: string;
  /** Optional muted suffix (e.g. version / source album) shown smaller in the queue. */
  titleSuffix?: string | null;
  artist?: string | null;
  artistId?: number | null;
  releaseId?: string | null;
  releaseTitle?: string | null;
  /** ISO / folder date for cover tooltip. */
  releaseDate?: string | null;
  coverUrl?: string | null;
  /** Optional absolute stream URL; otherwise derived from path. */
  playUrl?: string | null;
  /**
   * Manual queue inserts (Play next / Play last). Survives playFrom refresh
   * and is re-applied at the same relative slots (after current / at end).
   */
  queuedBy?: GlobalMusicQueuedBy | null;
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
  /** Unpinned / auto-hide mode. When false, bar is pinned (always on). */
  barHidden: boolean;
  /** Temporary reveal while unpinned (hover peek or track-change flash). */
  barPeeking: boolean;
  queueOpen: boolean;
  /** Fullscreen now-playing / visualizer overlay. */
  visualizerOpen: boolean;
  hasTrack: boolean;
};

type ContextBlob = {
  queue: GlobalMusicTrack[];
  originalQueue: GlobalMusicTrack[];
  index: number;
  progress: number;
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
  activeContextKey?: string;
  contexts?: Record<string, ContextBlob>;
};

const STORAGE_KEY = "mystack.globalMusicPlayer.v2";
const LEGACY_SESSION_KEY = "mystack.globalMusicPlayer.v1";
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
/** Default unpinned — bar stays hidden until the user pins or peeks. */
let barHidden = true;
let barPeeking = false;
let peekTimer: ReturnType<typeof setTimeout> | null = null;
let queueOpen = false;
let visualizerOpen = false;
let userId: number | undefined;
let endedHandlerAttached = false;
let restoredPaused = false;
/** Cached for useSyncExternalStore — must be referentially stable until notify(). */
let snapshot: GlobalMusicSnapshot = {
  queue: [],
  index: -1,
  current: null,
  playing: false,
  progress: 0,
  duration: 0,
  volume: 1,
  repeatOne: false,
  shuffle: false,
  barHidden: true,
  barPeeking: false,
  queueOpen: false,
  visualizerOpen: false,
  hasTrack: false,
};

function buildSnapshot(): GlobalMusicSnapshot {
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
    barPeeking,
    queueOpen,
    visualizerOpen: visualizerOpen && Boolean(cur),
    hasTrack: Boolean(cur),
  };
}

function notify() {
  snapshot = buildSnapshot();
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
  if (typeof localStorage === "undefined") return;
  try {
    saveActiveContext();
    const contexts: Record<string, ContextBlob> = {};
    for (const [key, blob] of contextStore.entries()) {
      contexts[key] = blob;
    }
    const blob: PersistBlob = {
      queue,
      originalQueue,
      index,
      progress: audioEl?.currentTime ?? progress,
      volume,
      repeatOne,
      shuffle,
      barHidden,
      activeContextKey,
      contexts,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    /* ignore quota */
  }
}

function loadPersist(): PersistBlob | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PersistBlob;
  } catch {
    /* ignore */
  }
  // One-time migrate from sessionStorage v1.
  if (typeof sessionStorage === "undefined") return null;
  try {
    const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy) as PersistBlob;
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
    return parsed;
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

function scheduleBarPeek(ms = 2600) {
  if (!barHidden) return;
  barPeeking = true;
  notify();
  if (peekTimer) clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    peekTimer = null;
    if (!barHidden) return;
    barPeeking = false;
    notify();
  }, ms);
}

async function loadIndex(
  i: number,
  autoPlay: boolean,
  opts?: { previousId?: string | null; peek?: boolean }
) {
  const el = ensureAudio();
  if (!el) return;
  if (i < 0 || i >= queue.length) {
    clearPlayback(true);
    return;
  }
  // Never let a dash-card preview keep sounding under the main player.
  killDashPreviewsForMainPlay();
  // Callers may already have rewritten `queue`/`index` (playFrom) — allow an
  // explicit previous id so peek/compare stays correct.
  const prevId =
    opts && "previousId" in opts
      ? opts.previousId ?? null
      : currentTrack()?.id ?? null;
  index = i;
  const track = queue[i];
  const url = streamUrlFor(track);
  resumeBeatAudioContext();
  el.src = url;
  publishSession(track, el);
  applyPlaybackThemeFromCover(track.coverUrl ?? null, userId);
  reportPlay(track);
  // Peek only on user-driven track changes — never on idle restore / seed.
  if (opts?.peek !== false && barHidden && track.id !== prevId) {
    scheduleBarPeek();
  }
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

/** Collect manual inserts so a playFrom refresh can re-seat them. */
function collectManualInserts(): {
  nexts: GlobalMusicTrack[];
  lasts: GlobalMusicTrack[];
} {
  const nexts: GlobalMusicTrack[] = [];
  const lasts: GlobalMusicTrack[] = [];
  for (const t of queue) {
    if (t.queuedBy === "next") nexts.push({ ...t });
    else if (t.queuedBy === "last") lasts.push({ ...t });
  }
  return { nexts, lasts };
}

function applyManualInserts(
  base: GlobalMusicTrack[],
  manuals: { nexts: GlobalMusicTrack[]; lasts: GlobalMusicTrack[] },
  currentIndex = 0
): GlobalMusicTrack[] {
  const out = base.slice();
  const seen = new Set(out.map((t) => t.id));
  const nexts = manuals.nexts.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  const lasts = manuals.lasts.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  const insertAt = Math.min(Math.max(0, currentIndex + 1), out.length);
  if (nexts.length) out.splice(insertAt, 0, ...nexts);
  if (lasts.length) out.push(...lasts);
  return out;
}

function normalizeOne(track: GlobalMusicTrack): GlobalMusicTrack | null {
  const list = normalizeTracks([track]);
  return list[0] ?? null;
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
  visualizerOpen = false;
  barPeeking = false;
  if (peekTimer) {
    clearTimeout(peekTimer);
    peekTimer = null;
  }
  setPlaybackPlaying(false);
  endPlaybackThemeSession(userId);
  notify();
  if (clearStorage) {
    try {
      localStorage?.removeItem(STORAGE_KEY);
      sessionStorage?.removeItem(LEGACY_SESSION_KEY);
    } catch {
      /* ignore */
    }
    contextStore.clear();
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
  return snapshot;
}

export function subscribeGlobalMusic(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setGlobalMusicUserId(id: number | undefined) {
  userId = id;
}

/**
 * Play a tracklist starting at `startIndex`.
 * Queue keeps tracks before the current one so Previous can walk backward.
 * Manual play-next / play-last inserts are re-seated after current / at end.
 *
 * `startIndex` is resolved against the caller list by id/path after dedupe —
 * never reused as a raw index into the normalized queue (duplicate paths in
 * multi-edition tracklists would shift and play the wrong song).
 */
export function globalMusicPlayFrom(
  tracks: GlobalMusicTrack[],
  startIndex: number,
  opts?: { autoPlay?: boolean }
) {
  if (!tracks.length) return;
  const preferred =
    tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))] ?? tracks[0];
  const wantId = (preferred?.id || "").trim();
  const wantPath = (preferred?.path || "").trim();
  const list = normalizeTracks(tracks);
  if (!list.length) return;
  const previousId = currentTrack()?.id ?? null;
  const manuals = collectManualInserts();
  const base = list.map((t) => ({ ...t, queuedBy: null as const }));
  originalQueue = base.slice();
  let startId =
    base.find((t) => (wantId && t.id === wantId) || (wantPath && t.path === wantPath))
      ?.id ?? null;
  if (!startId) startId = base[0]?.id ?? null;
  let nextQueue = shuffle
    ? buildShuffledOrder(originalQueue, startId)
    : originalQueue.slice();
  let playAt = shuffle
    ? 0
    : Math.max(
        0,
        nextQueue.findIndex((t) => t.id === startId)
      );
  nextQueue = applyManualInserts(nextQueue, manuals, playAt);
  // Re-resolve index in case manuals shifted the current track.
  if (!shuffle && startId) {
    playAt = Math.max(
      0,
      nextQueue.findIndex((t) => t.id === startId)
    );
  }
  queue = nextQueue;
  index = playAt;
  queueOpen = false;
  void loadIndex(playAt, opts?.autoPlay !== false, { previousId });
}

/** Insert immediately after the current track (manual — survives playFrom). */
export function globalMusicPlayNext(track: GlobalMusicTrack) {
  const t = normalizeOne({ ...track, queuedBy: "next" });
  if (!t) return;
  if (!queue.length || index < 0) {
    queue = [t];
    originalQueue = [{ ...t, queuedBy: null }];
    void loadIndex(0, true);
    return;
  }
  const existing = queue.findIndex((q) => q.id === t.id);
  if (existing === index) return;
  if (existing >= 0) {
    queue.splice(existing, 1);
    if (existing < index) index -= 1;
  }
  const at = Math.min(index + 1, queue.length);
  queue.splice(at, 0, t);
  notify();
  persist();
}

/** Append to the end of the queue (manual — survives playFrom). */
export function globalMusicPlayLast(track: GlobalMusicTrack) {
  const t = normalizeOne({ ...track, queuedBy: "last" });
  if (!t) return;
  if (!queue.length || index < 0) {
    queue = [t];
    originalQueue = [{ ...t, queuedBy: null }];
    void loadIndex(0, true);
    return;
  }
  const existing = queue.findIndex((q) => q.id === t.id);
  if (existing === index) return;
  if (existing >= 0) {
    queue.splice(existing, 1);
    if (existing < index) index -= 1;
  }
  queue.push(t);
  notify();
  persist();
}

/** Replace queue with full list and start at index (used when reshuffling context). */
export function globalMusicPlayList(
  tracks: GlobalMusicTrack[],
  startIndex = 0,
  opts?: { autoPlay?: boolean }
) {
  if (!tracks.length) return;
  const preferred =
    tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))] ?? tracks[0];
  const wantId = (preferred?.id || "").trim();
  const wantPath = (preferred?.path || "").trim();
  const list = normalizeTracks(tracks);
  if (!list.length) return;
  const previousId = currentTrack()?.id ?? null;
  originalQueue = list.slice();
  let currentId =
    list.find((t) => (wantId && t.id === wantId) || (wantPath && t.path === wantPath))
      ?.id ?? null;
  if (!currentId) currentId = list[0]?.id ?? null;
  queue = shuffle
    ? buildShuffledOrder(originalQueue, currentId)
    : originalQueue.slice();
  index = shuffle
    ? 0
    : Math.max(
        0,
        currentId ? queue.findIndex((t) => t.id === currentId) : 0
      );
  void loadIndex(index, opts?.autoPlay !== false, { previousId });
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

/** Jump to a queue index and play (used by the queue list). */
export function globalMusicPlayAt(i: number) {
  if (i < 0 || i >= queue.length) return;
  if (i === index) {
    const el = ensureAudio();
    if (el?.paused) {
      resumeBeatAudioContext();
      void el.play().catch(() => {});
    }
    return;
  }
  void loadIndex(i, true);
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
  if (hidden) {
    queueOpen = false;
  } else {
    barPeeking = false;
    if (peekTimer) {
      clearTimeout(peekTimer);
      peekTimer = null;
    }
  }
  notify();
  persist();
}

/** Pin = always visible; unpin = auto-hide (overlay on hover). */
export function globalMusicTogglePinned() {
  globalMusicSetBarHidden(!barHidden);
}

export function globalMusicToggleQueueOpen() {
  queueOpen = !queueOpen;
  // Queue panel already forces bar visibility — do not pin (barHidden=false),
  // or the next persist() would restore a pinned bar after login.
  notify();
}

export function globalMusicSetVisualizerOpen(open: boolean) {
  if (open && !currentTrack()) return;
  visualizerOpen = open;
  if (open) queueOpen = false;
  notify();
}

export function globalMusicToggleVisualizer() {
  globalMusicSetVisualizerOpen(!visualizerOpen);
}

export function globalMusicSetQueueOpen(open: boolean) {
  queueOpen = open;
  notify();
}

const contextStore = new Map<string, ContextBlob>();
let activeContextKey = "music";

function saveActiveContext() {
  if (!queue.length) {
    contextStore.delete(activeContextKey);
    return;
  }
  contextStore.set(activeContextKey, {
    queue: queue.slice(),
    originalQueue: originalQueue.slice(),
    index,
    progress: audioEl?.currentTime ?? progress,
  });
}

function mergeContextQueueKeepingCurrent(
  contextTracks: GlobalMusicTrack[],
  cur: GlobalMusicTrack
): { queue: GlobalMusicTrack[]; originalQueue: GlobalMusicTrack[] } {
  const manuals = collectManualInserts();
  const base = [
    { ...cur, queuedBy: null as const },
    ...contextTracks
      .filter((t) => t.id !== cur.id && t.path !== cur.path)
      .map((t) => ({ ...t, queuedBy: null as const })),
  ];
  const merged = applyManualInserts(base, manuals, 0);
  return {
    queue: merged,
    originalQueue: base.map((t) => ({ ...t, queuedBy: null })),
  };
}

/**
 * Adopt a module / franchise / universe soundtrack pool into the global bar.
 * - If a track is currently playing, keep it playing and refresh the queue
 *   (Play next / Play last inserts are preserved).
 * - If idle and this context was saved before, restore that last position.
 * - Otherwise load the first context track paused (no autoplay).
 * Peek is opt-in (`peek: true`) — idle mount/restore stays hidden.
 */
export function globalMusicAdoptContext(
  tracks: GlobalMusicTrack[],
  opts?: { contextKey?: string; peek?: boolean; forcePoolStart?: boolean }
) {
  ensureHydrated();
  const key = (opts?.contextKey || "module").trim() || "module";
  const list = normalizeTracks(tracks);
  if (!list.length) return;
  const wantPeek = opts?.peek === true;

  if (key !== activeContextKey) {
    saveActiveContext();
    activeContextKey = key;
  }

  const cur = currentTrack();
  const el = ensureAudio();
  const wasPlaying = Boolean(el && !el.paused && cur);

  // Playing: keep current track; swap upcoming to this context; keep manuals.
  if (cur && (wasPlaying || playing)) {
    const merged = mergeContextQueueKeepingCurrent(list, cur);
    queue = merged.queue;
    originalQueue = merged.originalQueue;
    index = Math.max(
      0,
      queue.findIndex((t) => t.id === cur.id || t.path === cur.path)
    );
    if (wantPeek) scheduleBarPeek(2800);
    notify();
    persist();
    return;
  }

  // Idle: prefer restoring this context's last queue/position when available.
  const saved = !opts?.forcePoolStart ? contextStore.get(key) : undefined;
  if (saved?.queue?.length && !opts?.forcePoolStart) {
    const previousId = cur?.id ?? null;
    queue = saved.queue.slice();
    originalQueue = (
      saved.originalQueue.length ? saved.originalQueue : saved.queue
    ).slice();
    const nextIndex = Math.max(
      0,
      Math.min(saved.index ?? 0, queue.length - 1)
    );
    void loadIndex(nextIndex, false, { previousId, peek: wantPeek }).then(() => {
      const audio = ensureAudio();
      if (!audio) return;
      const seekTo = typeof saved.progress === "number" ? saved.progress : 0;
      if (seekTo > 0 && Number.isFinite(seekTo)) {
        try {
          audio.currentTime = seekTo;
          progress = seekTo;
          notify();
        } catch {
          /* ignore */
        }
      }
    });
    if (wantPeek) scheduleBarPeek(2800);
    persist();
    return;
  }

  // First visit / empty context: soundtrack pool from track 1, paused.
  originalQueue = list.map((t) => ({ ...t, queuedBy: null }));
  queue = originalQueue.slice();
  index = 0;
  void loadIndex(0, false, { previousId: cur?.id ?? null, peek: wantPeek });
  if (wantPeek) scheduleBarPeek(2800);
  persist();
}

/** Restore a previously saved context (e.g. Music stack queue). */
export function globalMusicRestoreContext(
  contextKey: string,
  opts?: { peek?: boolean }
): boolean {
  ensureHydrated();
  const key = contextKey.trim() || "music";
  const wantPeek = opts?.peek === true;
  if (key === activeContextKey && queue.length) {
    if (wantPeek) scheduleBarPeek(2800);
    return true;
  }
  saveActiveContext();
  const blob = contextStore.get(key);
  activeContextKey = key;
  if (!blob?.queue?.length) {
    persist();
    return false;
  }

  const cur = currentTrack();
  const el = ensureAudio();
  const wasPlaying = Boolean(el && !el.paused && cur);

  // Never interrupt an in-progress listen when swapping contexts.
  if (cur && (wasPlaying || playing)) {
    const merged = mergeContextQueueKeepingCurrent(
      blob.originalQueue.length ? blob.originalQueue : blob.queue,
      cur
    );
    queue = merged.queue;
    originalQueue = merged.originalQueue;
    index = Math.max(
      0,
      queue.findIndex((t) => t.id === cur.id || t.path === cur.path)
    );
    if (wantPeek) scheduleBarPeek(2800);
    notify();
    persist();
    return true;
  }

  const previousId = cur?.id ?? null;
  queue = blob.queue.slice();
  originalQueue = (
    blob.originalQueue.length ? blob.originalQueue : blob.queue
  ).slice();
  const nextIndex = Math.max(
    0,
    Math.min(blob.index ?? 0, queue.length - 1)
  );
  void loadIndex(nextIndex, false, { previousId, peek: wantPeek }).then(() => {
    const audio = ensureAudio();
    if (!audio) return;
    const seekTo = typeof blob.progress === "number" ? blob.progress : 0;
    if (seekTo > 0 && Number.isFinite(seekTo)) {
      try {
        audio.currentTime = seekTo;
        progress = seekTo;
        notify();
      } catch {
        /* ignore */
      }
    }
  });
  if (wantPeek) scheduleBarPeek(2800);
  persist();
  return true;
}

/** Seed a context only when it has no saved/active queue (e.g. On Repeat). */
export function globalMusicSeedContextIfEmpty(
  tracks: GlobalMusicTrack[],
  opts?: { contextKey?: string; peek?: boolean }
): boolean {
  // Never seed before localStorage hydrate — child effects can run before App init
  // and would overwrite the restored session (e.g. Heartless → On Repeat #1).
  ensureHydrated();
  const key = (opts?.contextKey || "music").trim() || "music";
  const list = normalizeTracks(tracks);
  if (!list.length) return false;
  if (key === activeContextKey && queue.length) return false;
  if (contextStore.get(key)?.queue?.length) return false;
  // Persisted session exists but isn't the active context yet — don't clobber it.
  if (hasPersistedQueue()) return false;
  const wantPeek = opts?.peek === true;
  if (key !== activeContextKey) {
    saveActiveContext();
    activeContextKey = key;
  }
  originalQueue = list.map((t) => ({ ...t, queuedBy: null }));
  queue = originalQueue.slice();
  index = 0;
  void loadIndex(0, false, { previousId: null, peek: wantPeek });
  if (wantPeek) scheduleBarPeek(2800);
  persist();
  return true;
}

export function globalMusicHasContext(contextKey: string): boolean {
  const key = contextKey.trim() || "music";
  if (key === activeContextKey && queue.length) return true;
  return Boolean(contextStore.get(key)?.queue?.length);
}

export function globalMusicGetContextKey() {
  return activeContextKey;
}

export function getGlobalMusicAudioElement(): HTMLAudioElement | null {
  return ensureAudio();
}

function hasPersistedQueue(): boolean {
  const blob = loadPersist();
  if (!blob) return false;
  if (blob.queue?.length) return true;
  if (!blob.contexts) return false;
  return Object.values(blob.contexts).some((ctx) => Boolean(ctx?.queue?.length));
}

/** Restore paused session from localStorage (safe to call more than once). */
function hydrateFromStorage() {
  if (restoredPaused) return;
  restoredPaused = true;
  const blob = loadPersist();
  if (!blob) return;

  contextStore.clear();
  if (blob.contexts) {
    for (const [key, ctx] of Object.entries(blob.contexts)) {
      if (!ctx?.queue?.length) continue;
      contextStore.set(key, {
        queue: normalizeTracks(ctx.queue),
        originalQueue: normalizeTracks(
          ctx.originalQueue?.length ? ctx.originalQueue : ctx.queue
        ),
        index: ctx.index ?? 0,
        progress: typeof ctx.progress === "number" ? ctx.progress : 0,
      });
    }
  }
  activeContextKey = (blob.activeContextKey || "music").trim() || "music";

  if (!blob.queue?.length) {
    notify();
    return;
  }
  queue = normalizeTracks(blob.queue);
  originalQueue = normalizeTracks(
    blob.originalQueue?.length ? blob.originalQueue : blob.queue
  );
  index = Math.max(0, Math.min(blob.index ?? 0, queue.length - 1));
  volume = typeof blob.volume === "number" ? blob.volume : 1;
  repeatOne = Boolean(blob.repeatOne);
  shuffle = Boolean(blob.shuffle);
  // Always start unpinned; pin is a session gesture, not a login restore.
  barHidden = true;
  barPeeking = false;
  const el = ensureAudio();
  if (!el || !queue[index]) {
    notify();
    return;
  }
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
  // Restore paused — user hits play.
  notify();
}

function ensureHydrated() {
  hydrateFromStorage();
}

/** Call once from App mount — restore paused session + dash preview bridge. */
export function initGlobalMusicPlayer() {
  hydrateFromStorage();
  ensureAudio();
  setDashPreviewMainPlayer({
    pause: () => globalMusicPause(),
    resume: () => globalMusicResume(),
    getVolume: () => volume,
    wasPlaying: () => Boolean(audioEl && !audioEl.paused && currentTrack()),
  });
}

// Hydrate before any React child effect can seed On Repeat over a restored session.
if (typeof window !== "undefined") {
  hydrateFromStorage();
}
