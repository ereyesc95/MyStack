import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MusicDashPreview } from "../types";
import {
  beginDashPreview,
  dashPreviewHasGesture,
  dashPreviewVolume,
  endDashPreview,
  isDashPreviewToken,
  registerDashPreviewHardStop,
  setDashPreviewMediaActive,
} from "../dashPreviewController";
import { resumeBeatAudioContext } from "../beatAudioGraph";
import { musicStreamUrl } from "../musicStreamUrl";
import { withMediaAccess } from "../mediaFileUrl";
import { useBeatPulse } from "../useBeatPulse";

const DWELL_MS = 850;
const EXCERPT_SEC = 10;
/** Short but noticeable fade for preview audio/video. */
const FADE_MS = 400;

export type DashPreviewOverlay = {
  active: boolean;
  mediaKind: "video" | "audio" | null;
  mediaTitle: string | null;
  artworkUrl: string | null;
  artistName: string | null;
  artistLogoUrl: string | null;
  artistLogoCollapsedUrl: string | null;
  artistIconUrl: string | null;
  /** True when live beat analysis is driving the card pulse. */
  beating: boolean;
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
  beating: false,
};

type Props = {
  armed: boolean;
  requestKey: string;
  load: () => Promise<MusicDashPreview | null>;
  onOverlay: (state: DashPreviewOverlay) => void;
  beatHostRef?: React.RefObject<HTMLElement | null>;
};

type FadeSignal = { cancelled: boolean };

function stripBrackets(title: string | null | undefined): string {
  let t = (title || "").replace(/\s*\[[^\]]*\]/g, "").trim();
  // Full dated-folder prefix (must run before leftover MM.DD. cleanup).
  t = t.replace(/^\d{4}(?:\.\d{1,2}){0,2}\.\s*/, "").trim();
  // Backend track-# strip can leave ``02.14. Title`` when year was eaten first.
  t = t.replace(/^\d{1,2}\.\d{1,2}\.\s*/, "").trim();
  return t;
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

function fadeMediaVolume(
  el: HTMLMediaElement,
  to: number,
  ms: number,
  signal: FadeSignal
): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.min(1, Math.max(0, to));
    const from = el.volume;
    if (ms <= 0 || Math.abs(from - target) < 0.008) {
      if (!signal.cancelled) el.volume = target;
      resolve();
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      if (signal.cancelled) {
        resolve();
        return;
      }
      const t = Math.min(1, (now - t0) / ms);
      const e = t * t * (3 - 2 * t);
      el.volume = from + (target - from) * e;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        el.volume = target;
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
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
  const mediaElRef = useRef<HTMLMediaElement | null>(null);
  const tokenRef = useRef(0);
  const sessionRef = useRef(0);
  const loadRef = useRef(load);
  const onOverlayRef = useRef(onOverlay);
  const fadeSignalRef = useRef<FadeSignal | null>(null);
  const fadingRef = useRef(false);
  const endingRef = useRef(false);
  const targetVolRef = useRef(1);
  const excerptTimerRef = useRef(0);
  loadRef.current = load;
  onOverlayRef.current = onOverlay;
  const [candidate, setCandidate] = useState<MusicDashPreview | null>(null);
  const [visible, setVisible] = useState(false);
  const [mediaPlaying, setMediaPlaying] = useState(false);

  useEffect(() => {
    return registerDashPreviewHardStop(() => {
      if (fadeSignalRef.current) fadeSignalRef.current.cancelled = true;
      fadeSignalRef.current = null;
      fadingRef.current = false;
      window.clearTimeout(excerptTimerRef.current);
      setDashPreviewMediaActive(false);
      const el = mediaElRef.current;
      if (el) {
        try {
          el.pause();
          el.volume = 0;
        } catch {
          /* ignore */
        }
      }
      mediaElRef.current = null;
      tokenRef.current = 0;
      endingRef.current = false;
      setVisible(false);
      setMediaPlaying(false);
      setCandidate(null);
      onOverlayRef.current(EMPTY_OVERLAY);
    });
  }, []);

  const cancelFade = () => {
    if (fadeSignalRef.current) fadeSignalRef.current.cancelled = true;
    fadeSignalRef.current = null;
    fadingRef.current = false;
  };

  const runFade = (el: HTMLMediaElement, to: number) => {
    cancelFade();
    const signal: FadeSignal = { cancelled: false };
    fadeSignalRef.current = signal;
    fadingRef.current = true;
    return fadeMediaVolume(el, to, FADE_MS, signal).finally(() => {
      if (fadeSignalRef.current === signal) {
        fadeSignalRef.current = null;
        fadingRef.current = false;
      }
    });
  };

  const softEnd = () => {
    const token = tokenRef.current;
    if (!token || endingRef.current) {
      if (!token) {
        setCandidate(null);
        setVisible(false);
        setMediaPlaying(false);
        onOverlayRef.current(EMPTY_OVERLAY);
      }
      return;
    }
    endingRef.current = true;
    const session = sessionRef.current;
    window.clearTimeout(excerptTimerRef.current);
    setVisible(false);
    // Keep mediaPlaying true during fade so volume/unmute sync stays attached;
    // beat analysis can wind down via setDashPreviewMediaActive(false) at finish.
    const el = mediaElRef.current;

    const finish = () => {
      setDashPreviewMediaActive(false);
      setMediaPlaying(false);
      endDashPreview(token);
      if (tokenRef.current === token) tokenRef.current = 0;
      // Only clear UI if nothing newer took over
      if (sessionRef.current === session) {
        mediaElRef.current = null;
        setCandidate(null);
        onOverlayRef.current(EMPTY_OVERLAY);
      }
      endingRef.current = false;
    };

    if (el) {
      void runFade(el, 0).then(() => {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
        finish();
      });
    } else {
      window.setTimeout(finish, FADE_MS);
    }
  };

  useEffect(() => {
    if (!armed || !requestKey) {
      softEnd();
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
        sessionRef.current += 1;
        endingRef.current = false;
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
          beating: false,
        });
        requestAnimationFrame(() => {
          if (!cancelled && isDashPreviewToken(token)) setVisible(true);
        });
      })();
    }, DWELL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(dwell);
      softEnd();
    };
  }, [armed, requestKey]);

  // Drive media as soon as the element is mounted
  useLayoutEffect(() => {
    if (!candidate) return;
    const token = tokenRef.current;
    const session = sessionRef.current;
    const src = previewSrc(candidate);
    if (!src) return;
    const isVideo = candidate.media_kind === "video";

    let stopped = false;
    let raf = 0;
    let el: HTMLMediaElement | null = null;
    let onMeta: (() => void) | null = null;
    let onCanPlay: (() => void) | null = null;

    const stopPreview = () => {
      if (stopped) return;
      stopped = true;
      softEnd();
    };

    const startPlay = () => {
      if (stopped || !el || !isDashPreviewToken(token)) return;
      if (sessionRef.current !== session) return;
      resumeBeatAudioContext();
      targetVolRef.current = dashPreviewVolume();
      el.volume = 0;
      const go = () => {
        if (stopped || !el || sessionRef.current !== session) return;
        setMediaPlaying(true);
        setDashPreviewMediaActive(true);
        if (dashPreviewHasGesture()) {
          el.muted = false;
        }
        void runFade(el, targetVolRef.current).then(() => {
          if (stopped || !el || !isDashPreviewToken(token)) return;
          if (sessionRef.current !== session) return;
          excerptTimerRef.current = window.setTimeout(
            stopPreview,
            EXCERPT_SEC * 1000
          );
        });
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
      mediaElRef.current = media;
      const muted = !dashPreviewHasGesture();
      // Keep mute under JS control — a React `muted` prop re-applies on every
      // overlay/beat re-render and silences audio after play() succeeds.
      // Do not set crossOrigin: same-origin streams use cookies/tokens and
      // anonymous CORS breaks Web Audio analysis (static pulses).
      media.defaultMuted = muted;
      media.muted = muted;
      media.volume = 0;
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
      if (tries++ < 60) {
        raf = requestAnimationFrame(waitForEl);
      } else {
        stopPreview();
      }
    };
    waitForEl();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(excerptTimerRef.current);
      // Soft-end owns pause/fade when intentional; hard teardown only if
      // candidate is being replaced before soft-end finishes.
      if (el && !endingRef.current) {
        cancelFade();
        if (onMeta) el.removeEventListener("loadedmetadata", onMeta);
        if (onCanPlay) el.removeEventListener("canplay", onCanPlay);
        el.pause();
        el.removeAttribute("src");
        try {
          el.load();
        } catch {
          /* ignore */
        }
        if (mediaElRef.current === el) mediaElRef.current = null;
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
      if (!fadingRef.current) {
        el.volume = targetVolRef.current;
      }
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

  const previewBeatHosts = beatHostRef ? [beatHostRef] : undefined;
  useBeatPulse(
    mediaElRef,
    Boolean(candidate && mediaPlaying),
    Boolean(candidate && mediaPlaying),
    previewBeatHosts
  );

  // Publish beating flag for card CSS from the shared --beat-strength vars.
  useEffect(() => {
    if (!candidate || !mediaPlaying) return;
    setDashPreviewMediaActive(true);
    let raf = 0;
    let beating = false;
    const tick = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--beat-strength")
        .trim();
      const strength = Number.parseFloat(raw) || 0;
      const next = strength > 0.08;
      if (next !== beating) {
        beating = next;
        onOverlayRef.current({
          active: true,
          mediaKind: candidate.media_kind === "video" ? "video" : "audio",
          mediaTitle: stripBrackets(candidate.title),
          artworkUrl: candidate.artwork_url || null,
          artistName:
            candidate.artist_name ||
            candidate.series_title ||
            candidate.parent_title ||
            null,
          artistLogoUrl: candidate.artist_logo_url || null,
          artistLogoCollapsedUrl: candidate.artist_logo_collapsed_url || null,
          artistIconUrl: candidate.artist_icon_url || null,
          beating,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [candidate, mediaPlaying]);

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
        />
      ) : (
        <audio
          ref={audioRef}
          className="dash-morph__preview-audio"
          preload="auto"
        />
      )}
    </span>
  );
}

export { EMPTY_OVERLAY };
