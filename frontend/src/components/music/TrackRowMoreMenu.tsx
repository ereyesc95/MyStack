import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

type MenuPos = {
  top: number;
  left: number;
  openDown: boolean;
};

export default function TrackRowMoreMenu({
  track,
  onAddToPlaylist,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = window.requestAnimationFrame(() => setShown(true));
      return () => window.cancelAnimationFrame(id);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), 160);
    return () => window.clearTimeout(t);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const rect = btnRef.current!.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight || 128;
      const menuW = menuRef.current?.offsetWidth || 180;
      const spaceAbove = rect.top;
      const openDown = spaceAbove < menuH + 12;
      const top = openDown
        ? Math.min(window.innerHeight - menuH - 8, rect.bottom + 4)
        : Math.max(8, rect.top - menuH - 4);
      const left = Math.min(
        Math.max(8, rect.right - menuW),
        window.innerWidth - menuW - 8
      );
      setPos({ top, left, openDown });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
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

  const menu =
    mounted && pos
      ? createPortal(
          <div
            ref={menuRef}
            className={`track-row-more__menu${shown ? " is-shown" : ""}${
              pos.openDown ? " is-down" : " is-up"
            }`}
            role="menu"
            style={{ top: pos.top, left: pos.left }}
          >
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
              <span>Add to playlist</span>
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
          </div>,
          document.body
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={`track-row-more${open ? " is-open" : ""}`}
    >
      <button
        ref={btnRef}
        type="button"
        className="track-row-more__btn"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => {
            const next = !v;
            if (next && btnRef.current) {
              const rect = btnRef.current.getBoundingClientRect();
              const menuH = 128;
              const menuW = 180;
              const openDown = rect.top < menuH + 12;
              const top = openDown
                ? Math.min(window.innerHeight - menuH - 8, rect.bottom + 4)
                : Math.max(8, rect.top - menuH - 4);
              const left = Math.min(
                Math.max(8, rect.right - menuW),
                window.innerWidth - menuW - 8
              );
              setPos({ top, left, openDown });
            }
            return next;
          });
        }}
      >
        <KebabIcon className="track-row-more__kebab" />
      </button>
      {menu}
    </div>
  );
}
