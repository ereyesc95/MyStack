import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import MediaBeatFx from "./components/music/MediaBeatFx";
import {
  getDashPreviewBackdrop,
  subscribeDashPreviewBackdrop,
} from "./dashPreviewController";
import { getGlobalMusicAudioElement } from "./globalMusicPlayer";
import { useBeatPulse } from "./useBeatPulse";

/** Crossfade cover backdrop while audio is playing; clears on pause/stop. */
export function usePlaybackCoverBg(
  playing: boolean,
  coverUrl: string | null | undefined,
  previewBackdrop?: string | null
): {
  showBg: boolean;
  layers: { current: string | undefined; outgoing: string | undefined };
} {
  const playbackBgUrl = previewBackdrop
    ? previewBackdrop
    : playing && coverUrl
      ? coverUrl
      : undefined;
  const [layers, setLayers] = useState<{
    current: string | undefined;
    outgoing: string | undefined;
  }>(() => ({ current: undefined, outgoing: undefined }));
  const prevRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!playbackBgUrl) {
      setLayers({ current: undefined, outgoing: undefined });
      prevRef.current = undefined;
      return;
    }
    if (playbackBgUrl === prevRef.current) return;
    const outgoing = prevRef.current;
    prevRef.current = playbackBgUrl;
    setLayers({ current: playbackBgUrl, outgoing });
    const t = window.setTimeout(() => {
      setLayers((s) => ({ current: s.current, outgoing: undefined }));
    }, 360);
    return () => window.clearTimeout(t);
  }, [playbackBgUrl]);

  return { showBg: Boolean(layers.current), layers };
}

/** Cover stack + beat FX matching Music Home playback atmosphere. */
export function PlaybackCoverAtmosphere({
  playing,
  hasSrc: _hasSrc,
  coverUrl,
}: {
  playing: boolean;
  hasSrc: boolean;
  coverUrl: string | null | undefined;
}) {
  const previewBackdrop = useSyncExternalStore(
    subscribeDashPreviewBackdrop,
    getDashPreviewBackdrop,
    () => null
  );
  const { showBg, layers } = usePlaybackCoverBg(
    playing,
    coverUrl,
    previewBackdrop
  );
  if (showBg) {
    return (
      <div className="artist-page__bg-stack" aria-hidden>
        {layers.outgoing ? (
          <div
            className="artist-page__bg artist-page__bg--visible artist-page__bg--out"
            style={{ backgroundImage: `url("${layers.outgoing}")` }}
          />
        ) : null}
        {layers.current ? (
          <div
            className={`artist-page__bg artist-page__bg--visible${
              layers.outgoing ? " artist-page__bg--in" : ""
            }`}
            style={{ backgroundImage: `url("${layers.current}")` }}
          />
        ) : null}
        <MediaBeatFx />
      </div>
    );
  }
  // Keep FX mounted so dash-card preview pulses can light the page even when
  // the main player is idle.
  void _hasSrc;
  return <MediaBeatFx />;
}

export function moduleHomePlaybackClassNames(opts: {
  backdrop?: boolean;
  showPlaybackBg?: boolean;
  hasSrc?: boolean;
  playing?: boolean;
}): string {
  const showBg = Boolean(opts.showPlaybackBg);
  return `${opts.backdrop || showBg ? " music-module--backdrop" : ""}${
    opts.hasSrc || opts.playing ? " music-module--beat-ready" : ""
  }${opts.playing ? " music-module--playing" : ""}`;
}

/** Drive page-wide beat CSS vars from the global player on module homes. */
export function useModuleHomeBeatPulse(opts: {
  enabled: boolean;
  playing: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  audioRef.current = getGlobalMusicAudioElement();
  useBeatPulse(audioRef, opts.enabled, opts.playing);
}
