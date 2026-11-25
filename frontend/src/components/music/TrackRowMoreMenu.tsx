import { useEffect, useRef, useState } from "react";
import {
  globalMusicPlayLast,
  globalMusicPlayNext,
  type GlobalMusicTrack,
} from "../../globalMusicPlayer";
import { TrackActionPlaylistIcon } from "./release/releaseTrackActionIcons";

type Props = {
  track: GlobalMusicTrack;
  onAddToPlaylist: () => void;
  disabled?: boolean;
};

function KebabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="5" r="1.75" fill="currentColor" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
      <circle cx="12" cy="19" r="1.75" fill="currentColor" />
    </svg>
  );
}

function PlayNextIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 5v14l9-7-9-7zM16 5v14M19 5v14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayLastIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 5v14l9-7-9-7zM17 5v14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 8v8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function TrackRowMoreMenu({
  track,
  onAddToPlaylist,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || rootRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (disabled || !track.path) return null;

  return (
    <div
      ref={rootRef}
      className={`track-row-more${open ? " is-open" : ""}`}
    >
      <button
        type="button"
        className="track-row-more__btn"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <KebabIcon className="track-row-more__kebab" />
      </button>
      {open ? (
        <div className="track-row-more__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="track-row-more__item"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onAddToPlaylist();
            }}
          >
            <TrackActionPlaylistIcon className="track-row-more__icon" />
            <span>Add to playlists</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="track-row-more__item"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              globalMusicPlayNext(track);
            }}
          >
            <PlayNextIcon className="track-row-more__icon" />
            <span>Play next</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="track-row-more__item"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              globalMusicPlayLast(track);
            }}
          >
            <PlayLastIcon className="track-row-more__icon" />
            <span>Play last</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
