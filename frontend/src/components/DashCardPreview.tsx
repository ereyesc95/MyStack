import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MusicDashPreview } from "../types";
import {
  beginDashPreview,
  dashPreviewHasGesture,
  dashPreviewVolume,
  endDashPreview,
  isDashPreviewToken,
} from "../dashPreviewController";
import { getBeatAnalyser, resumeBeatAudioContext } from "../beatAudioGraph";
import { musicStreamUrl } from "../musicStreamUrl";
import { withMediaAccess } from "../mediaFileUrl";

const DWELL_MS = 850;
const EXCERPT_SEC = 10;
const FADE_MS = 450;

export type DashPreviewOverlay = {
  active: boolean;
  mediaKind: "video" | "audio" | null;
  mediaTitle: string | null;
  artworkUrl: string | null;
  artistName: string | null;
  artistLogoUrl: string | null;
  artistLogoCollapsedUrl: string | null;
  artistIconUrl: string | null;
};

const EMPTY_OVERLAY: DashPreviewOverlay = {
  active: false,
  mediaKind: null,
  mediaTitle: null,
  artworkUrl: null,
  artistName: null,
  artistLogoUrl: null,
  artistLogoCollapsedUrl: null,
  artistIconUrl: null,
};

type Props = {
  armed: boolean;
  requestKey: string;
  load: () => Promise<MusicDashPreview | null>;
  onOverlay: (state: DashPreviewOverlay) => void;
  beatHostRef?: React.RefObject<HTMLElement | null>;
};

function stripBrackets(title: string | null | undefined): string {
  return (title || "").replace(/\s*\[[^\]]*]/g, "").trim();
}

function pickExcerptStart(duration: number): number {
  if (!Number.isFinite(duration) || duration <= EXCERPT_SEC + 1) return 0;
  const maxStart = duration * 0.7;
  return Math.random() * Math.max(0, maxStart - EXCERPT_SEC);
}

/** Prefer path-based URLs so auth/access helpers match the main player. */
function previewSrc(data: MusicDashPreview): string | null {
  const path = (data.path || "").trim();
  if (data.media_kind === "audio" && path) {
    return musicStreamUrl(path);
  }
  if (data.media_kind === "video" && path) {
    return withMediaAccess(
      `/api/media/file?path=${encodeURIComponent(path.replace(/\\/g, "/"))}`
    );
  }
  return data.media_url || null;
}

export default function DashCardPreview({
  armed,
  requestKey,
  load,
  onOverlay,
  beatHostRef,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const tokenRef = useRef(0);
  const loadRef = useRef(load);
  const onOverlayRef = useRef(onOverlay);
  loadRef.current = load;
  onOverlayRef.current = onOverlay;
  const [candidate, setCandidate] = useState<MusicDashPreview | null>(null);
  const [visible, setVisible] = useState(false);
  const [mediaPlaying, setMediaPlaying] = useState(false);

  useEffect(() => {
    if (!armed || !requestKey) {
      const token = tokenRef.current;
      if (token) endDashPreview(token);
      tokenRef.current = 0;
      setCandidate(null);
      setVisible(false);
      setMediaPlaying(false);
      onOverlayRef.current(EMPTY_OVERLAY);
      return;
    }

    let cancelled = false;
    const dwell = window.setTimeout(() => {
      void (async () => {
        let data: MusicDashPreview | null = null;
        try {
          data = await loadRef.current();
        } catch {
          data = null;
        }
        if (cancelled || !data || (!data.media_url && !data.path)) return;
        if (!previewSrc(data)) return;
        const token = beginDashPreview();
        tokenRef.current = token;
        if (!isDashPreviewToken(token)) return;
        setCandidate(data);
        onOverlayRef.current({
          active: true,
          mediaKind: data.media_kind === "video" ? "video" : "audio",
          mediaTitle: stripBrackets(data.title),
          artworkUrl: data.artwork_url || null,
          artistName:
            data.artist_name || data.series_title || data.parent_title || null,
          artistLogoUrl: data.artist_logo_url || null,
          artistLogoCollapsedUrl: data.artist_logo_collapsed_url || null,
          artistIconUrl: data.artist_icon_url || null,
        });
        requestAnimationFrame(() => {
          if (!cancelled && isDashPreviewToken(token)) setVisible(true);
        });
      })();
    }, DWELL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(dwell);
      const token = tokenRef.current;
      if (token) endDashPreview(token);
      tokenRef.current = 0;
      setCandidate(null);
      setVisible(false);
      setMediaPlaying(false);
      onOverlayRef.current(EMPTY_OVERLAY);
    };
  }, [armed, requestKey]);

  // Drive media as soon as the element is mounted
  useLayoutEffect(() => {
    if (!candidate) return;
    const token = tokenRef.current;
    const src = previewSrc(candidate);
    if (!src) return;
    const isVideo = candidate.media_kind === "video";

    let stopped = false;
    let endAt = 0;
    let raf = 0;
    let el: HTMLMediaElement | null = null;
    let onMeta: (() => void) | null = null;
    let onCanPlay: (() => void) | null = null;

    const stopPreview = () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(endAt);
      setMediaPlaying(false);
      setVisible(false);
      window.setTimeout(() => {
        endDashPreview(token);
        if (tokenRef.current === token) tokenRef.current = 0;
        setCandidate(null);
        onOverlayRef.current(EMPTY_OVERLAY);
      }, FADE_MS);
    };

    const startPlay = () => {
      if (stopped || !el || !isDashPreviewToken(token)) return;
      resumeBeatAudioContext();
      const go = () => {
        if (stopped || !el) return;
        setMediaPlaying(true);
        if (dashPreviewHasGesture()) {
          el.muted = false;
          el.volume = dashPreviewVolume();
        }
        endAt = window.setTimeout(stopPreview, EXCERPT_SEC * 1000);
      };
      void el.play().then(go, () => {
        if (!el || stopped) return;
        el.muted = true;
        el.volume = 0;
        void el.play().then(go, () => stopPreview());
      });
    };

    const attach = (media: HTMLMediaElement) => {
      el = media;
      const muted = !dashPreviewHasGesture();
      media.defaultMuted = true;
      media.muted = muted;
      media.volume = muted ? 0 : dashPreviewVolume();
      media.src = src;
      onMeta = () => {
        if (stopped || !isDashPreviewToken(token)) return;
        try {
          const start = pickExcerptStart(media.duration || 0);
          if (start > 0) media.currentTime = start;
        } catch {
          /* ignore */
        }
      };
      onCanPlay = startPlay;
      media.addEventListener("loadedmetadata", onMeta);
      media.addEventListener("canplay", onCanPlay, { once: true });
      try {
        media.load();
      } catch {
        /* ignore */
      }
    };

    let tries = 0;
    const waitForEl = () => {
      const found = (isVideo ? videoRef.current : audioRef.current) as
        | HTMLMediaElement
        | null;
      if (found) {
        attach(found);
        return;
      }
      if (tries++ < 10) {
        raf = requestAnimationFrame(waitForEl);
      } else {
        stopPreview();
      }
    };
    waitForEl();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(endAt);
      if (el) {
        if (onMeta) el.removeEventListener("loadedmetadata", onMeta);
        if (onCanPlay) el.removeEventListener("canplay", onCanPlay);
        el.pause();
        el.removeAttribute("src");
        try {
          el.load();
        } catch {
          /* ignore */
        }
      }
      setMediaPlaying(false);
    };
  }, [candidate]);

  // Unmute after a real gesture while preview is live
  useEffect(() => {
    if (!candidate || !mediaPlaying) return;
    const sync = () => {
      if (!dashPreviewHasGesture()) return;
      const isVideo = candidate.media_kind === "video";
      const el = (isVideo ? videoRef.current : audioRef.current) as
        | HTMLMediaElement
        | null;
      if (!el) return;
      el.muted = false;
      el.volume = dashPreviewVolume();
      resumeBeatAudioContext();
    };
    window.addEventListener("pointerdown", sync, { passive: true });
    window.addEventListener("keydown", sync, { passive: true });
    sync();
    return () => {
      window.removeEventListener("pointerdown", sync);
      window.removeEventListener("keydown", sync);
    };
  }, [candidate, mediaPlaying]);

  // Card-local beat vars
  useEffect(() => {
    if (!candidate || !mediaPlaying) return;
    const isVideo = candidate.media_kind === "video";
    const el = (isVideo ? videoRef.current : audioRef.current) as
      | HTMLMediaElement
      | null;
    const host = beatHostRef?.current;
    if (!el || !host) return;

    let analyser: AnalyserNode | null = null;
    try {
      analyser = getBeatAnalyser(el);
    } catch {
      analyser = null;
    }
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    let prev = 0;
    const tick = () => {
      analyser!.getByteFrequencyData(data);
      let sum = 0;
      const n = Math.min(32, data.length);
      for (let i = 0; i < n; i++) sum += data[i];
      const instant = sum / (n * 255);
      const pulse = prev * 0.72 + instant * 0.28;
      prev = pulse;
      const strength = String(Math.min(0.82, pulse * 1.1));
      host.style.setProperty("--beat-pulse", String(pulse));
      host.style.setProperty("--beat-bass", String(pulse * 0.9));
      host.style.setProperty("--beat-strength", strength);
      document.documentElement.style.setProperty("--beat-pulse", String(pulse));
      document.documentElement.style.setProperty(
        "--beat-bass",
        String(pulse * 0.9)
      );
      document.documentElement.style.setProperty("--beat-strength", strength);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      host.style.setProperty("--beat-pulse", "0");
      host.style.setProperty("--beat-bass", "0");
      host.style.setProperty("--beat-strength", "0");
    };
  }, [candidate, mediaPlaying, beatHostRef]);

  if (!candidate) return null;

  const isVideo = candidate.media_kind === "video";

  return (
    <span
      className={`dash-morph__preview${visible ? " is-on" : ""}`}
      aria-hidden
    >
      {isVideo ? (
        <video
          ref={videoRef}
          className="dash-morph__preview-media"
          playsInline
          preload="auto"
          muted
        />
      ) : (
        <audio ref={audioRef} className="dash-morph__preview-audio" preload="auto" muted />
      )}
    </span>
  );
}

export { EMPTY_OVERLAY };
