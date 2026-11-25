import { useEffect, useSyncExternalStore, useRef, useState } from "react";
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

  const visible =
    snap.hasTrack && (!snap.barHidden || edgeHover || snap.queueOpen);

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

  // Mobile: tap bottom edge zone to reveal when hidden
  useEffect(() => {
    if (!snap.barHidden) return;
    const onTap = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const fromBottom = window.innerHeight - e.clientY;
      if (fromBottom < 36) {
        setEdgeHover(true);
        globalMusicSetBarHidden(false);
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

  if (!snap.hasTrack && !snap.barHidden) return null;
  if (!snap.hasTrack) return null;

  const cur = snap.current as GlobalMusicTrack;
  const pct = snap.duration ? (snap.progress / snap.duration) * 100 : 0;

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
          className="global-music-edge"
          aria-label="Show player"
          onClick={() => globalMusicSetBarHidden(false)}
        />
      ) : null}
      <div
        ref={barRef}
        className={`global-music-bar${visible ? " is-visible" : " is-hidden"}${
          snap.queueOpen ? " is-queue-open" : ""
        }`}
        onMouseEnter={() => {
          if (snap.barHidden) setEdgeHover(true);
        }}
        onMouseLeave={() => {
          if (snap.barHidden && !snap.queueOpen) setEdgeHover(false);
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
                    <span className="global-music-queue__title">{t.title}</span>
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
          </button>

          <div className="global-music-bar__text">
            <button
              type="button"
              className="global-music-bar__title"
              onClick={openRelease}
              disabled={!(cur.artistId != null && cur.releaseId)}
            >
              {cur.title}
            </button>
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
              className="artist-mini-player__seek"
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
            <button
              type="button"
              className="global-music-bar__hide"
              onClick={() => globalMusicSetBarHidden(true)}
              aria-label="Hide player"
            >
              ▾
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
