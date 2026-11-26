import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  getGlobalMusicSnapshot,
  globalMusicClear,
  globalMusicNext,
  globalMusicPlayAt,
  globalMusicPrev,
  globalMusicRemoveAt,
  globalMusicReorder,
  globalMusicSeekRatio,
  globalMusicSetBarHidden,
  globalMusicSetQueueOpen,
  globalMusicToggle,
  globalMusicToggleQueueOpen,
  globalMusicToggleRepeatOne,
  globalMusicToggleShuffle,
  subscribeGlobalMusic,
  type GlobalMusicTrack,
} from "../globalMusicPlayer";
import { trackMainTitle } from "./music/release/releaseTrackPanelMeta";
import {
  TrackActionLyricsIcon,
  TrackActionVersionsIcon,
} from "./music/release/releaseTrackActionIcons";
import { formatTrackDate } from "../formatDate";
import { usePhoneLayout } from "../usePhoneLayout";
import {
  getActiveReleasePlayerAction,
  subscribeReleasePlayerActionActive,
  toggleReleasePlayerAction,
  type ReleasePlayerAction,
} from "../releasePlayerActions";

export type GlobalMusicBarNav = {
  onOpenArtist?: (bandId: number, name?: string | null) => void;
  onOpenRelease?: (
    bandId: number,
    releaseId: string,
    meta?: {
      artistName?: string | null;
      title?: string | null;
      tab?: "overview" | "tracklist" | "gallery";
    }
  ) => void;
};

function useGlobalMusic() {
  return useSyncExternalStore(
    subscribeGlobalMusic,
    getGlobalMusicSnapshot,
    getGlobalMusicSnapshot
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Pushpin / thumbtack — not a map location marker. */
function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden
    >
      <path
        d="M16 3c.6 0 1 .4 1 1v1h1c.6 0 1 .4 1 1s-.4 1-1 1h-1.1l-1.2 7H17c.6 0 1 .4 1 1s-.4 1-1 1h-4v6c0 .6-.4 1-1 1s-1-.4-1-1v-6H7c-.6 0-1-.4-1-1s.4-1 1-1h1.3L7.1 7H6c-.6 0-1-.4-1-1s.4-1 1-1h1V4c0-.6.4-1 1-1h8z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Album title for cover tip — drop paths, dates, edition / remaster suffixes. */
function cleanReleaseTitle(raw: string | null | undefined): string {
  let t = (raw || "").trim();
  if (!t) return "";
  if (/[\\/]/.test(t)) {
    const parts = t.replace(/\\/g, "/").split("/").filter(Boolean);
    // Prefer the segment under an Audio category when present.
    const cats = new Set([
      "albums",
      "extended plays",
      "compilations",
      "demos",
      "singles",
      "soundtracks",
      "live albums",
    ]);
    let pick = parts[parts.length - 1] || t;
    for (let i = parts.length - 2; i >= 0; i--) {
      if (cats.has(parts[i]!.toLowerCase())) {
        pick = parts[i + 1]!;
        break;
      }
    }
    // Drop trailing edition/disc/side folders.
    while (parts.length) {
      const last = parts[parts.length - 1]!.replace(
        /^\d{4}(?:\.\d{1,2}){0,2}\.\s*/,
        ""
      );
      if (
        /\bedition\b/i.test(last) ||
        /^disc\s+\d+/i.test(last) ||
        /^side\s+[a-z]\b/i.test(last)
      ) {
        parts.pop();
        continue;
      }
      break;
    }
    t = (parts[parts.length - 1] || pick).trim();
  }
  t = t.replace(/^\d{4}(?:\.\d{1,2}){0,2}\.\s*/, "").trim();
  t = t.replace(/\s*[\(\[][^)\]]*[\)\]]\s*$/g, "").trim();
  t = t
    .replace(
      /:\s*.*\b(edition|remaster(ed)?|deluxe|expanded|anniversary)\b.*$/i,
      ""
    )
    .trim();
  t = t
    .replace(
      /\s+-\s+.*\b(edition|remaster(ed)?|deluxe|expanded|anniversary)\b.*$/i,
      ""
    )
    .trim();
  t = t
    .replace(/\s+\b(standard|deluxe|remastered|expanded)\s+edition\b.*$/i, "")
    .trim();
  return t;
}

function useBillboardScroll(text: string) {
  const clipRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [scroll, setScroll] = useState(false);
  const [end, setEnd] = useState("0px");
  const [duration, setDuration] = useState("8s");

  useLayoutEffect(() => {
    const clip = clipRef.current;
    const inner = innerRef.current;
    if (!clip || !inner) return;
    const measure = () => {
      inner.style.transform = "";
      void inner.offsetWidth;
      const overflow = Math.max(0, inner.scrollWidth - clip.clientWidth);
      const needs = overflow > 2;
      setScroll(needs);
      setEnd(needs ? `-${overflow}px` : "0px");
      setDuration(`${Math.max(6, overflow / 28)}s`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(clip);
    return () => ro.disconnect();
  }, [text]);

  return { clipRef, innerRef, scroll, end, duration };
}

function ScrollingTitle({
  text,
  onClick,
  disabled,
}: {
  text: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const { clipRef, innerRef, scroll, end, duration } = useBillboardScroll(text);

  return (
    <button
      type="button"
      className="global-music-bar__title"
      onClick={onClick}
      disabled={disabled}
    >
      <span
        ref={clipRef}
        className={`global-music-bar__title-clip${
          scroll ? " is-scroll" : ""
        }`}
        style={
          scroll
            ? ({
                "--scroll-end": end,
                "--scroll-duration": duration,
              } as CSSProperties)
            : undefined
        }
      >
        <span ref={innerRef} className="global-music-bar__title-inner">
          {text}
        </span>
      </span>
    </button>
  );
}

function ScrollingArtist({
  text,
  onClick,
  disabled,
}: {
  text: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const { clipRef, innerRef, scroll, end, duration } = useBillboardScroll(text);

  return (
    <button
      type="button"
      className="global-music-bar__artist"
      onClick={onClick}
      disabled={disabled}
      title="Open artist"
    >
      <span
        ref={clipRef}
        className={`global-music-bar__title-clip${
          scroll ? " is-scroll" : ""
        }`}
        style={
          scroll
            ? ({
                "--scroll-end": end,
                "--scroll-duration": duration,
              } as CSSProperties)
            : undefined
        }
      >
        <span ref={innerRef} className="global-music-bar__title-inner">
          {text}
        </span>
      </span>
    </button>
  );
}

type Props = GlobalMusicBarNav;

export default function GlobalMusicBar({
  onOpenArtist,
  onOpenRelease,
}: Props) {
  const snap = useGlobalMusic();
  const phone = usePhoneLayout();
  const [edgeHover, setEdgeHover] = useState(false);
  const [slideDir, setSlideDir] = useState<"next" | "prev" | null>(null);
  const [slideKey, setSlideKey] = useState(0);
  const dragFrom = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const edgeLeaveTimer = useRef<number | null>(null);
  const trackIdRef = useRef<string | null>(null);
  const swipeRef = useRef<{ x: number; y: number; active: boolean } | null>(
    null
  );

  const clearEdgeLeaveTimer = () => {
    if (edgeLeaveTimer.current != null) {
      window.clearTimeout(edgeLeaveTimer.current);
      edgeLeaveTimer.current = null;
    }
  };

  const keepEdgeHover = () => {
    clearEdgeLeaveTimer();
    setEdgeHover(true);
  };

  const scheduleEdgeHoverOff = () => {
    clearEdgeLeaveTimer();
    edgeLeaveTimer.current = window.setTimeout(() => {
      edgeLeaveTimer.current = null;
      setEdgeHover(false);
    }, 280);
  };

  const goPrev = () => {
    setSlideDir("prev");
    setSlideKey((k) => k + 1);
    globalMusicPrev();
  };
  const goNext = () => {
    setSlideDir("next");
    setSlideKey((k) => k + 1);
    globalMusicNext();
  };

  const pinned = snap.hasTrack && !snap.barHidden;
  const visible =
    snap.hasTrack &&
    (!snap.barHidden || edgeHover || snap.queueOpen || snap.barPeeking);

  useEffect(() => {
    if (!snap.barHidden) {
      clearEdgeLeaveTimer();
      setEdgeHover(false);
      return;
    }
    const onMove = (e: PointerEvent) => {
      const fromBottom = window.innerHeight - e.clientY;
      // Tall enough to cover the seek strip at the top of the unpinned bar.
      if (fromBottom < 96) {
        keepEdgeHover();
      } else if (!barRef.current?.contains(e.target as Node)) {
        scheduleEdgeHoverOff();
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      clearEdgeLeaveTimer();
    };
  }, [snap.barHidden]);

  useEffect(() => {
    if (!snap.barHidden) return;
    const onTap = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const fromBottom = window.innerHeight - e.clientY;
      if (fromBottom < 96) {
        keepEdgeHover();
      }
    };
    window.addEventListener("pointerdown", onTap, { passive: true });
    return () => window.removeEventListener("pointerdown", onTap);
  }, [snap.barHidden]);

  useEffect(() => {
    if (!snap.queueOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (barRef.current?.contains(t)) return;
      globalMusicSetQueueOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [snap.queueOpen]);

  // Spacebar play/pause when a track is loaded (ignore typing in fields).
  useEffect(() => {
    if (!snap.hasTrack) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      e.preventDefault();
      globalMusicToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snap.hasTrack]);

  // Drive CSS var so 100vh/100dvh pages (release/artist) clear the pinned bar.
  useEffect(() => {
    const root = document.documentElement;
    if (pinned) {
      root.classList.add("mystack-player-pinned");
      root.style.setProperty("--mystack-player-pad", "3.35rem");
    } else {
      root.classList.remove("mystack-player-pinned");
      root.style.setProperty("--mystack-player-pad", "0px");
    }
    return () => {
      root.classList.remove("mystack-player-pinned");
      root.style.setProperty("--mystack-player-pad", "0px");
    };
  }, [pinned]);

  // External track changes (auto-advance) still get a slide when id changes.
  useEffect(() => {
    const id = snap.current?.id ?? null;
    const prev = trackIdRef.current;
    trackIdRef.current = id;
    if (prev && id && prev !== id && !slideDir) {
      setSlideDir("next");
      setSlideKey((k) => k + 1);
    }
  }, [snap.current?.id, slideDir]);

  useEffect(() => {
    if (!slideDir) return;
    const t = window.setTimeout(() => setSlideDir(null), 320);
    return () => window.clearTimeout(t);
  }, [slideKey, slideDir]);

  // Must stay above the hasTrack early-return (Rules of Hooks).
  const activeAction = useSyncExternalStore(
    subscribeReleasePlayerActionActive,
    getActiveReleasePlayerAction,
    getActiveReleasePlayerAction
  );

  if (!snap.hasTrack) return null;

  const cur = snap.current as GlobalMusicTrack;
  const pct = snap.duration ? (snap.progress / snap.duration) * 100 : 0;
  const displayTitle = trackMainTitle(cur.title) || cur.title;
  const releaseTipTitle =
    cleanReleaseTitle(cur.releaseTitle) ||
    String(cur.releaseTitle || "")
      .replace(/^\d{4}(?:\.\d{1,2}){0,2}\.\s*/, "")
      .trim();
  const albumBesideArtist = phone ? "" : releaseTipTitle;
  const releaseTipDate =
    formatTrackDate(cur.releaseDate) ||
    (cur.releaseDate && /^\d{4}/.test(cur.releaseDate)
      ? cur.releaseDate.slice(0, 10).replace(/-/g, ".")
      : null);

  const openArtist = () => {
    if (cur.artistId != null) onOpenArtist?.(cur.artistId, cur.artist);
  };
  const openRelease = (tab: "overview" | "tracklist" = "overview") => {
    if (cur.artistId != null && cur.releaseId) {
      onOpenRelease?.(cur.artistId, cur.releaseId, {
        artistName: cur.artist,
        title: cur.releaseTitle,
        tab,
      });
    }
  };

  const openTrackAction = (action: ReleasePlayerAction) => {
    if (cur.artistId == null || !cur.releaseId) return;
    const result = toggleReleasePlayerAction({
      action,
      bandId: cur.artistId,
      releaseId: cur.releaseId,
      trackPath: cur.path,
      trackTitle: cur.title,
    });
    if (result === "closed") return;
    openRelease("tracklist");
  };

  const onMetaPointerDown = (e: ReactPointerEvent) => {
    if (!phone) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, active: true };
  };
  const onMetaPointerUp = (e: ReactPointerEvent) => {
    if (!phone || !swipeRef.current?.active) return;
    const start = swipeRef.current;
    swipeRef.current = null;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    if (dx < 0) goNext();
    else goPrev();
  };
  const onMetaPointerCancel = () => {
    swipeRef.current = null;
  };

  const slideClass =
    slideDir === "next"
      ? " is-slide-next"
      : slideDir === "prev"
        ? " is-slide-prev"
        : "";

  return (
    <>
      {/* Invisible bottom hover strip when hidden — no floating pin chrome. */}
      {snap.barHidden && !visible ? (
        <div className="global-music-edge" aria-hidden />
      ) : null}
      <div
        ref={barRef}
        className={`global-music-bar${visible ? " is-visible" : " is-hidden"}${
          pinned ? " is-pinned" : " is-overlay"
        }${snap.queueOpen ? " is-queue-open" : ""}`}
        onMouseEnter={() => {
          if (snap.barHidden) keepEdgeHover();
        }}
        onMouseLeave={() => {
          if (snap.barHidden && !snap.queueOpen && !snap.barPeeking) {
            scheduleEdgeHoverOff();
          }
        }}
      >
        <div
          className={`global-music-queue${snap.queueOpen ? " is-open" : ""}`}
          role="list"
          aria-hidden={!snap.queueOpen}
        >
          <div className="global-music-queue__inner">
            <div className="global-music-queue__head">
              <span>Queue</span>
              <button
                type="button"
                className="global-music-queue__clear"
                onClick={() => globalMusicClear()}
              >
                Clear
              </button>
            </div>
            <ul
              className="global-music-queue__list"
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDropAt(null);
                }
              }}
            >
              {snap.queue.map((t, i) => (
                <li
                  key={`${t.id}-${i}`}
                  className={`global-music-queue__row${
                    i === snap.index ? " is-current" : ""
                  }${i < snap.index ? " is-passed" : ""}${
                    dropAt === i ? " is-drop-before" : ""
                  }${
                    dropAt === snap.queue.length && i === snap.queue.length - 1
                      ? " is-drop-after"
                      : ""
                  }`}
                  draggable
                  onDragStart={() => {
                    dragFrom.current = i;
                  }}
                  onDragEnd={() => {
                    dragFrom.current = null;
                    setDropAt(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const before = e.clientY < rect.top + rect.height / 2;
                    setDropAt(before ? i : i + 1);
                  }}
                  onDrop={() => {
                    const from = dragFrom.current;
                    const insertAt = dropAt;
                    dragFrom.current = null;
                    setDropAt(null);
                    if (from == null || insertAt == null) return;
                    const to = from < insertAt ? insertAt - 1 : insertAt;
                    if (to === from) return;
                    globalMusicReorder(from, to);
                  }}
                  role="listitem"
                >
                  <span className="global-music-queue__grip" aria-hidden>
                    ⋮⋮
                  </span>
                  <button
                    type="button"
                    className="global-music-queue__play"
                    onClick={() => globalMusicPlayAt(i)}
                    aria-label={`Play ${trackMainTitle(t.title) || t.title}`}
                  >
                    {t.coverUrl ? (
                      <img
                        className="global-music-queue__cover"
                        src={t.coverUrl}
                        alt=""
                        draggable={false}
                      />
                    ) : (
                      <span className="global-music-queue__cover global-music-queue__cover--empty" />
                    )}
                    <span className="global-music-queue__meta">
                      <span className="global-music-queue__title">
                        {trackMainTitle(t.title) || t.title}
                        {t.titleSuffix ? (
                          <span className="global-music-queue__title-suffix">
                            {" "}
                            {t.titleSuffix}
                          </span>
                        ) : null}
                      </span>
                      {t.artist ? (
                        <span className="global-music-queue__artist">
                          {t.artist}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="global-music-queue__remove"
                    aria-label="Remove from queue"
                    onClick={() => globalMusicRemoveAt(i)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          className="global-music-bar__seek-top"
          role="group"
          aria-label="Track progress"
        >
          <input
            type="range"
            className="global-music-bar__seek-top-input"
            min={0}
            max={100}
            step={0.1}
            value={pct}
            onChange={(e) =>
              globalMusicSeekRatio(Number(e.target.value) / 100)
            }
            aria-label="Seek"
            style={
              {
                "--seek-pct": `${pct}%`,
              } as CSSProperties
            }
          />
        </div>

        <div className="global-music-bar__inner">
          <div
            className={`global-music-bar__meta${slideClass}`}
            onPointerDown={onMetaPointerDown}
            onPointerUp={onMetaPointerUp}
            onPointerCancel={onMetaPointerCancel}
          >
            <button
              type="button"
              className="global-music-bar__cover-btn"
              onClick={() => openRelease()}
              disabled={!(cur.artistId != null && cur.releaseId)}
              aria-label="Open release"
              title="Open release"
            >
              {cur.coverUrl ? (
                <img
                  key={`cover-${slideKey}-${cur.id}`}
                  src={cur.coverUrl}
                  alt=""
                  className="global-music-bar__cover"
                />
              ) : (
                <span className="global-music-bar__cover global-music-bar__cover--empty" />
              )}
              {!phone && (releaseTipTitle || releaseTipDate) ? (
                <span className="global-music-bar__cover-tip" role="tooltip">
                  {releaseTipTitle ? (
                    <span className="global-music-bar__cover-tip-title">
                      {releaseTipTitle}
                    </span>
                  ) : null}
                  {releaseTipDate ? (
                    <span className="global-music-bar__cover-tip-date">
                      {releaseTipDate}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>

            <div
              className="global-music-bar__text"
              key={`text-${slideKey}-${cur.id}`}
            >
              <ScrollingTitle
                text={displayTitle}
                onClick={() => openRelease()}
                disabled={!(cur.artistId != null && cur.releaseId)}
              />
              {cur.artist || albumBesideArtist ? (
                <div className="global-music-bar__artist-line">
                  {cur.artist ? (
                    phone ? (
                      <ScrollingArtist
                        text={cur.artist}
                        onClick={openArtist}
                        disabled={cur.artistId == null}
                      />
                    ) : (
                      <button
                        type="button"
                        className="global-music-bar__artist"
                        onClick={openArtist}
                        disabled={cur.artistId == null}
                        title="Open artist"
                      >
                        {cur.artist}
                      </button>
                    )
                  ) : null}
                  {albumBesideArtist ? (
                    <>
                      <span className="global-music-bar__meta-dot" aria-hidden>
                        ·
                      </span>
                      <button
                        type="button"
                        className="global-music-bar__album"
                        onClick={() => openRelease()}
                        disabled={!(cur.artistId != null && cur.releaseId)}
                        title="Open release"
                      >
                        {albumBesideArtist}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="global-music-bar__right">
            {!phone ? (
              <div
                className="global-music-bar__controls artist-mini-player"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="artist-mini-player__skip artist-mini-player__skip--prev artist-mini-player__skip--chevron"
                  onClick={goPrev}
                  aria-label="Previous track"
                  title="Previous"
                />
                <button
                  type="button"
                  className="artist-mini-player__play"
                  onClick={() => globalMusicToggle()}
                  aria-label={snap.playing ? "Pause" : "Play"}
                  title={snap.playing ? "Pause" : "Play"}
                >
                  {snap.playing ? (
                    <span className="artist-mini-player__pause" />
                  ) : (
                    <span className="artist-mini-player__triangle" />
                  )}
                </button>
                <button
                  type="button"
                  className="artist-mini-player__skip artist-mini-player__skip--next artist-mini-player__skip--chevron"
                  onClick={goNext}
                  aria-label="Next track"
                  title="Next"
                />
              </div>
            ) : null}
            {!phone ? (
              <span className="global-music-bar__time" aria-hidden>
                {formatTime(snap.progress)}
              </span>
            ) : null}
            {phone ? (
              <div
                className="global-music-bar__controls artist-mini-player global-music-bar__controls--phone"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="artist-mini-player__play"
                  onClick={() => globalMusicToggle()}
                  aria-label={snap.playing ? "Pause" : "Play"}
                  title={snap.playing ? "Pause" : "Play"}
                >
                  {snap.playing ? (
                    <span className="artist-mini-player__pause" />
                  ) : (
                    <span className="artist-mini-player__triangle" />
                  )}
                </button>
              </div>
            ) : null}
            {cur.artistId != null && cur.releaseId ? (
              <>
                <button
                  type="button"
                  className={`global-music-bar__track-action${
                    activeAction?.action === "lyrics" &&
                    activeAction.trackPath === cur.path
                      ? " is-active"
                      : ""
                  }`}
                  onClick={() => openTrackAction("lyrics")}
                  aria-label="Lyrics"
                  title="Lyrics"
                  aria-pressed={
                    activeAction?.action === "lyrics" &&
                    activeAction.trackPath === cur.path
                  }
                >
                  <TrackActionLyricsIcon className="global-music-bar__track-action-icon" />
                </button>
                <button
                  type="button"
                  className={`global-music-bar__track-action${
                    activeAction?.action === "versions" &&
                    activeAction.trackPath === cur.path
                      ? " is-active"
                      : ""
                  }`}
                  onClick={() => openTrackAction("versions")}
                  aria-label="Versions"
                  title="Versions"
                  aria-pressed={
                    activeAction?.action === "versions" &&
                    activeAction.trackPath === cur.path
                  }
                >
                  <TrackActionVersionsIcon className="global-music-bar__track-action-icon" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              className={`artist-mini-player__repeat${
                snap.repeatOne ? " artist-mini-player__repeat--active" : ""
              }`}
              onClick={() => globalMusicToggleRepeatOne()}
              aria-label={
                snap.repeatOne ? "Disable repeat" : "Repeat track"
              }
              title={snap.repeatOne ? "Disable repeat" : "Repeat"}
              aria-pressed={snap.repeatOne}
            >
              ↻
            </button>
            <button
              type="button"
              className={`global-music-bar__shuffle${
                snap.shuffle ? " is-active" : ""
              }`}
              onClick={() => globalMusicToggleShuffle()}
              aria-label={snap.shuffle ? "Disable shuffle" : "Enable shuffle"}
              title={snap.shuffle ? "Disable shuffle" : "Shuffle"}
              aria-pressed={snap.shuffle}
            >
              ⇄
            </button>
            <button
              type="button"
              className={`global-music-bar__queue-btn${
                snap.queueOpen ? " is-active" : ""
              }`}
              onClick={() => globalMusicToggleQueueOpen()}
              aria-label="Queue"
              title="Queue"
              aria-pressed={snap.queueOpen}
            >
              ≡
            </button>
            {!phone ? (
              snap.barHidden ? (
                <button
                  type="button"
                  className="global-music-bar__hide global-music-bar__pin"
                  onClick={() => globalMusicSetBarHidden(false)}
                  aria-label="Pin player"
                  title="Pin player"
                >
                  <PinIcon />
                </button>
              ) : (
                <button
                  type="button"
                  className="global-music-bar__hide global-music-bar__hide--chevron"
                  onClick={() => globalMusicSetBarHidden(true)}
                  aria-label="Hide player"
                  title="Hide player"
                >
                  <span className="global-music-bar__hide-chevron" aria-hidden />
                </button>
              )
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
