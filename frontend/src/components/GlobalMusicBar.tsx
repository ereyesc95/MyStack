import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  getGlobalMusicSnapshot,
  globalMusicClear,
  globalMusicNext,
  globalMusicPrev,
  globalMusicRemoveAt,
  globalMusicReorder,
  globalMusicSeekRatio,
  globalMusicSetBarHidden,
  globalMusicSetQueueOpen,
  globalMusicSetVolume,
  globalMusicToggle,
  globalMusicToggleQueueOpen,
  globalMusicToggleRepeatOne,
  globalMusicToggleShuffle,
  subscribeGlobalMusic,
  type GlobalMusicTrack,
} from "../globalMusicPlayer";
import { trackMainTitle } from "./music/release/releaseTrackPanelMeta";
import { formatTrackDate } from "../formatDate";

export type GlobalMusicBarNav = {
  onOpenArtist?: (bandId: number, name?: string | null) => void;
  onOpenRelease?: (
    bandId: number,
    releaseId: string,
    meta?: { artistName?: string | null; title?: string | null }
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

/** Classic map-pin — clearer than a thin thumbtack at small size. */
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
        d="M12 2C8.7 2 6 4.7 6 8c0 4.5 6 12 6 12s6-7.5 6-12c0-3.3-2.7-6-6-6zm0 8.2a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4z"
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

function ScrollingTitle({
  text,
  onClick,
  disabled,
}: {
  text: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
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

type Props = GlobalMusicBarNav;

export default function GlobalMusicBar({
  onOpenArtist,
  onOpenRelease,
}: Props) {
  const snap = useGlobalMusic();
  const [edgeHover, setEdgeHover] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const volumeBeforeMute = useRef(1);

  const pinned = snap.hasTrack && !snap.barHidden;
  const visible =
    snap.hasTrack &&
    (!snap.barHidden || edgeHover || snap.queueOpen || snap.barPeeking);

  useEffect(() => {
    if (!snap.barHidden) {
      setEdgeHover(false);
      return;
    }
    const onMove = (e: PointerEvent) => {
      const fromBottom = window.innerHeight - e.clientY;
      setEdgeHover(fromBottom < 28);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [snap.barHidden]);

  useEffect(() => {
    if (!snap.barHidden) return;
    const onTap = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const fromBottom = window.innerHeight - e.clientY;
      if (fromBottom < 36) {
        setEdgeHover(true);
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
      root.style.setProperty("--mystack-player-pad", "3.1rem");
    } else {
      root.classList.remove("mystack-player-pinned");
      root.style.setProperty("--mystack-player-pad", "0px");
    }
    return () => {
      root.classList.remove("mystack-player-pinned");
      root.style.setProperty("--mystack-player-pad", "0px");
    };
  }, [pinned]);

  if (!snap.hasTrack) return null;

  const cur = snap.current as GlobalMusicTrack;
  const pct = snap.duration ? (snap.progress / snap.duration) * 100 : 0;
  const displayTitle = trackMainTitle(cur.title) || cur.title;
  const releaseTipTitle = cleanReleaseTitle(cur.releaseTitle);
  const releaseTipDate =
    formatTrackDate(cur.releaseDate) ||
    (cur.releaseDate && /^\d{4}/.test(cur.releaseDate)
      ? cur.releaseDate.slice(0, 10).replace(/-/g, ".")
      : null);

  const openArtist = () => {
    if (cur.artistId != null) onOpenArtist?.(cur.artistId, cur.artist);
  };
  const openRelease = () => {
    if (cur.artistId != null && cur.releaseId) {
      onOpenRelease?.(cur.artistId, cur.releaseId, {
        artistName: cur.artist,
        title: cur.releaseTitle,
      });
    }
  };

  return (
    <>
      {snap.barHidden && !visible ? (
        <button
          type="button"
          className="global-music-edge global-music-edge--pin"
          aria-label="Pin player"
          title="Pin player"
          onClick={() => globalMusicSetBarHidden(false)}
        >
          <PinIcon className="global-music-edge__pin" />
        </button>
      ) : null}
      <div
        ref={barRef}
        className={`global-music-bar${visible ? " is-visible" : " is-hidden"}${
          pinned ? " is-pinned" : " is-overlay"
        }${snap.queueOpen ? " is-queue-open" : ""}`}
        onMouseEnter={() => {
          if (snap.barHidden) setEdgeHover(true);
        }}
        onMouseLeave={() => {
          if (snap.barHidden && !snap.queueOpen && !snap.barPeeking) {
            setEdgeHover(false);
          }
        }}
      >
        {snap.queueOpen ? (
          <div className="global-music-queue" role="list">
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
            <ul className="global-music-queue__list">
              {snap.queue.map((t, i) => (
                <li
                  key={`${t.id}-${i}`}
                  className={`global-music-queue__row${
                    i === snap.index ? " is-current" : ""
                  }`}
                  draggable
                  onDragStart={() => {
                    dragFrom.current = i;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const from = dragFrom.current;
                    dragFrom.current = null;
                    if (from == null || from === i) return;
                    globalMusicReorder(from, i);
                  }}
                  role="listitem"
                >
                  <span className="global-music-queue__grip" aria-hidden>
                    ⋮⋮
                  </span>
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
                    </span>
                    {t.artist ? (
                      <span className="global-music-queue__artist">
                        {t.artist}
                      </span>
                    ) : null}
                  </span>
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
        ) : null}

        <div className="global-music-bar__inner">
          <button
            type="button"
            className="global-music-bar__cover-btn"
            onClick={openRelease}
            disabled={!(cur.artistId != null && cur.releaseId)}
            aria-label="Open release"
          >
            {cur.coverUrl ? (
              <img src={cur.coverUrl} alt="" className="global-music-bar__cover" />
            ) : (
              <span className="global-music-bar__cover global-music-bar__cover--empty" />
            )}
            {releaseTipTitle || releaseTipDate ? (
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

          <div className="global-music-bar__text">
            <ScrollingTitle
              text={displayTitle}
              onClick={openRelease}
              disabled={!(cur.artistId != null && cur.releaseId)}
            />
            {cur.artist ? (
              <button
                type="button"
                className="global-music-bar__artist"
                onClick={openArtist}
                disabled={cur.artistId == null}
              >
                {cur.artist}
              </button>
            ) : null}
          </div>

          <div className="global-music-bar__controls artist-mini-player">
            <button
              type="button"
              className="artist-mini-player__skip artist-mini-player__skip--prev"
              onClick={() => globalMusicPrev()}
              aria-label="Previous track"
            />
            <button
              type="button"
              className="artist-mini-player__play"
              onClick={() => globalMusicToggle()}
              aria-label={snap.playing ? "Pause" : "Play"}
            >
              {snap.playing ? (
                <span className="artist-mini-player__pause" />
              ) : (
                <span className="artist-mini-player__triangle" />
              )}
            </button>
            <button
              type="button"
              className="artist-mini-player__skip artist-mini-player__skip--next"
              onClick={() => globalMusicNext()}
              aria-label="Next track"
            />
            <input
              type="range"
              className="artist-mini-player__seek global-music-bar__seek"
              min={0}
              max={100}
              step={0.1}
              value={pct}
              onChange={(e) =>
                globalMusicSeekRatio(Number(e.target.value) / 100)
              }
              aria-label="Seek"
            />
            <span className="global-music-bar__time" aria-hidden>
              {formatTime(snap.progress)}
            </span>
            <div className="global-music-bar__volume">
              <button
                type="button"
                className={`global-music-bar__mute${
                  snap.volume <= 0.001 ? " is-muted" : ""
                }`}
                onClick={() => {
                  if (snap.volume > 0.001) {
                    volumeBeforeMute.current = snap.volume;
                    globalMusicSetVolume(0);
                  } else {
                    globalMusicSetVolume(
                      volumeBeforeMute.current > 0.001
                        ? volumeBeforeMute.current
                        : 1
                    );
                  }
                }}
                aria-label={snap.volume <= 0.001 ? "Unmute" : "Mute"}
                aria-pressed={snap.volume <= 0.001}
              >
                {snap.volume <= 0.001 ? "⌀" : "♪"}
              </button>
              <input
                type="range"
                className="global-music-bar__volume-slider"
                min={0}
                max={100}
                step={1}
                value={Math.round(snap.volume * 100)}
                onChange={(e) => {
                  const next = Number(e.target.value) / 100;
                  if (next > 0.001) volumeBeforeMute.current = next;
                  globalMusicSetVolume(next);
                }}
                aria-label="Volume"
              />
            </div>
            <button
              type="button"
              className={`global-music-bar__shuffle${
                snap.shuffle ? " is-active" : ""
              }`}
              onClick={() => globalMusicToggleShuffle()}
              aria-label={snap.shuffle ? "Disable shuffle" : "Enable shuffle"}
              aria-pressed={snap.shuffle}
            >
              ⇄
            </button>
            <button
              type="button"
              className={`artist-mini-player__repeat${
                snap.repeatOne ? " artist-mini-player__repeat--active" : ""
              }`}
              onClick={() => globalMusicToggleRepeatOne()}
              aria-label={
                snap.repeatOne ? "Disable repeat" : "Repeat track"
              }
              aria-pressed={snap.repeatOne}
            >
              ↻
            </button>
            <button
              type="button"
              className={`global-music-bar__queue-btn${
                snap.queueOpen ? " is-active" : ""
              }`}
              onClick={() => globalMusicToggleQueueOpen()}
              aria-label="Queue"
              aria-pressed={snap.queueOpen}
            >
              ≡
            </button>
            {snap.barHidden ? (
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
                className="global-music-bar__hide"
                onClick={() => globalMusicSetBarHidden(true)}
                aria-label="Hide player"
                title="Hide player"
              >
                ▾
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
