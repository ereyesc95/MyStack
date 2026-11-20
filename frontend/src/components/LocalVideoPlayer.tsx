import { useEffect, useRef, useState } from "react";
import { displayVideoDate } from "../utils/videoMedia";
import ModalPortal from "./ModalPortal";
import {
  clearNowPlaying,
  setNowPlaying,
  type NowPlayingInfo,
} from "../mediaSession";
import {
  getLocalVideoOpener,
  setLocalVideoOpener,
  type LocalVideoRequest,
} from "../utils/videoMedia";

function metaSecondLine(req: LocalVideoRequest): string {
  const artist = (req.artist || "").trim();
  const director = (req.director || "").trim();
  const date = displayVideoDate(req.releaseDate) || (req.releaseDate || "").trim();
  const extras: string[] = [];
  if (director) extras.push(director);
  if (date) extras.push(date);
  if (!artist && extras.length === 0) return "";
  if (!extras.length) return artist;
  if (!artist) return extras.join(" · ");
  return `${artist} · ${extras.join(" · ")}`;
}

/**
 * In-app fullscreen player for local music videos so Media Session can show
 * title/artist/artwork instead of a raw browser tab.
 */
export default function LocalVideoPlayerHost() {
  const [req, setReq] = useState<LocalVideoRequest | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reqRef = useRef<LocalVideoRequest | null>(null);
  reqRef.current = req;

  useEffect(() => {
    const prev = getLocalVideoOpener();
    setLocalVideoOpener((next) => setReq(next));
    return () => setLocalVideoOpener(prev);
  }, []);

  useEffect(() => {
    if (!req) {
      clearNowPlaying();
      return;
    }
    const publish = (el: HTMLVideoElement | null) => {
      if (!el) return;
      const info: NowPlayingInfo = {
        title: req.title || "Video",
        artist: req.artist || null,
        album: req.album || null,
        artworkUrl: req.artworkUrl || null,
      };
      setNowPlaying(info, {
        element: el,
        handlers: {
          play: () => void el.play().catch(() => {}),
          pause: () => el.pause(),
          seekTo: (seconds) => {
            el.currentTime = seconds;
          },
        },
      });
    };
    publish(videoRef.current);
    return () => {
      clearNowPlaying();
    };
  }, [req]);

  if (!req) return null;

  const playlist = req.playlist ?? [];
  const index = req.playlistIndex ?? -1;
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < playlist.length - 1;
  const secondLine = metaSecondLine(req);

  const goTo = (nextIndex: number) => {
    const item = playlist[nextIndex];
    if (!item?.url) return;
    setReq({
      ...item,
      playlist,
      playlistIndex: nextIndex,
    });
  };

  return (
    <ModalPortal onClose={() => setReq(null)}>
      <div
        className="local-video-player"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="local-video-player__close"
          aria-label="Close"
          onClick={() => setReq(null)}
        >
          ×
        </button>
        {hasPrev ? (
          <button
            type="button"
            className="local-video-player__nav local-video-player__nav--prev"
            aria-label="Previous video"
            onClick={() => goTo(index - 1)}
          >
            ‹
          </button>
        ) : null}
        {hasNext ? (
          <button
            type="button"
            className="local-video-player__nav local-video-player__nav--next"
            aria-label="Next video"
            onClick={() => goTo(index + 1)}
          >
            ›
          </button>
        ) : null}
        <video
          key={req.url}
          ref={(el) => {
            videoRef.current = el;
            if (!el || !reqRef.current) return;
            const info: NowPlayingInfo = {
              title: reqRef.current.title || "Video",
              artist: reqRef.current.artist || null,
              album: reqRef.current.album || null,
              artworkUrl: reqRef.current.artworkUrl || null,
            };
            setNowPlaying(info, {
              element: el,
              handlers: {
                play: () => void el.play().catch(() => {}),
                pause: () => el.pause(),
                seekTo: (seconds) => {
                  el.currentTime = seconds;
                },
              },
            });
          }}
          className="local-video-player__video"
          src={req.url}
          controls
          autoPlay
          playsInline
        />
        <div className="local-video-player__meta">
          <p className="local-video-player__title">{req.title || "Video"}</p>
          {secondLine ? (
            <p className="local-video-player__artist">
              {req.artist?.trim() ? (
                <>
                  <span className="local-video-player__artist-name">
                    {req.artist.trim()}
                  </span>
                  {(req.director?.trim() || req.releaseDate?.trim()) && (
                    <span className="local-video-player__artist-extra">
                      {" · "}
                      {[
                        req.director?.trim(),
                        displayVideoDate(req.releaseDate) ||
                          req.releaseDate?.trim(),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </>
              ) : (
                secondLine
              )}
            </p>
          ) : null}
        </div>
      </div>
    </ModalPortal>
  );
}
