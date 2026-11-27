import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  fetchTrackLyrics,
  fetchTrackSourceArt,
  type TrackVisualizerExtras,
} from "../../api";
import {
  getGlobalMusicAudioElement,
  getGlobalMusicSnapshot,
  globalMusicNext,
  globalMusicPrev,
  globalMusicSeekRatio,
  globalMusicSetVisualizerOpen,
  globalMusicSetVolume,
  globalMusicToggle,
  subscribeGlobalMusic,
  type GlobalMusicTrack,
} from "../../globalMusicPlayer";
import { IconLyrics, IconVisualizer } from "../MenuIcons";
import { isVideoMediaUrl } from "../../isVideoMediaUrl";
import { preloadImages } from "../../preloadMedia";
import { useBeatPulse } from "../../useBeatPulse";
import { useDeviceLayout, isMobilePortraitLayout } from "../../usePhoneLayout";
import { trackMainTitle } from "./release/releaseTrackPanelMeta";
import type { ReleasePlaybackArt } from "../../types";
import { createPortal } from "react-dom";

const CHROME_IDLE_MS = 3000;
const STILL_CROSSFADE_MS = 10_000;
const OVERLAY_FADE_MS = 340;
const SWIPE_MIN_PX = 56;
const MAX_STILLS = 4;

type LrcLine = { time: number; text: string };

const LRC_TIME_RE = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

function parseLrc(raw: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const matches = [...line.matchAll(LRC_TIME_RE)];
    if (!matches.length) continue;
    const text = line.replace(LRC_TIME_RE, "").trim();
    if (!text) continue;
    for (const m of matches) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(m[3].padEnd(3, "0")) / 1000 : 0;
      lines.push({ time: min * 60 + sec + frac, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function galleryUrls(
  items: { title?: string; url?: string; orientation?: string }[] | undefined,
  orientation: "landscape" | "portrait"
): string[] {
  if (!items?.length) return [];
  const wantPhoto = `photo - ${orientation}`;
  const out: string[] = [];
  for (const it of items) {
    const title = (it.title || "").toLowerCase();
    const ori = (it.orientation || "").toLowerCase();
    if (
      title.startsWith(wantPhoto) ||
      ori === orientation ||
      (orientation === "landscape" && title.startsWith("photo - banner"))
    ) {
      if (it.url) out.push(it.url);
    }
  }
  return out;
}

type BgLayer = {
  key: string;
  kind: "video" | "image";
  url: string;
};

function buildStills(
  art: ReleasePlaybackArt | null,
  gallery: { title?: string; url?: string; orientation?: string }[] | undefined,
  portrait: boolean,
  eraPhotos?: string[] | null
): string[] {
  const coverOrient = portrait
    ? art?.cover_portrait_url
    : art?.cover_landscape_url;
  const releasePhoto = portrait
    ? art?.photo_portrait_url
    : art?.photo_landscape_url;
  const photos = galleryUrls(gallery, portrait ? "portrait" : "landscape");
  const fallbacks = [
    art?.cover_banner_url,
    art?.cover_url,
    ...(art?.background_layers || []),
  ].filter(Boolean) as string[];
  const ordered: string[] = [];
  const push = (u: string | null | undefined) => {
    if (!u || ordered.includes(u)) return;
    ordered.push(u);
  };
  // Locked ladder: Cover orient → Photo - * → era dump photos → artwork extras → fallbacks.
  if (coverOrient) push(coverOrient);
  if (releasePhoto) push(releasePhoto);
  for (const p of eraPhotos || []) push(p);
  for (const p of photos) push(p);
  for (const f of fallbacks) push(f);
  return ordered.slice(0, MAX_STILLS);
}

/** Light preload — at most 2 stills (no video createElement). */
function preloadVisualizerStills(
  art: ReleasePlaybackArt | null,
  _extras?: TrackVisualizerExtras | null,
  portrait = false
) {
  const urls = [
    portrait ? art?.cover_portrait_url : art?.cover_landscape_url,
    portrait ? art?.photo_portrait_url : art?.photo_landscape_url,
    art?.cover_url,
  ].filter(Boolean) as string[];
  if (urls.length) void preloadImages(urls.slice(0, 2));
}

function primaryVideo(
  art: ReleasePlaybackArt | null,
  portrait: boolean
): string | null {
  if (prefersReducedMotion()) return null;
  if (portrait) return art?.canvas_url || null;
  return art?.visualizer_url || null;
}

export default function VisualizerOverlay() {
  const snap = useSyncExternalStore(
    subscribeGlobalMusic,
    getGlobalMusicSnapshot,
    getGlobalMusicSnapshot
  );
  const layout = useDeviceLayout();
  const portrait = isMobilePortraitLayout(layout);
  const open = snap.visualizerOpen && snap.hasTrack;
  const cur = snap.current;

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  audioRef.current = getGlobalMusicAudioElement();
  const beatHosts = useMemo(() => [rootRef], []);

  const [chromeVisible, setChromeVisible] = useState(true);
  const [chromePinned, setChromePinned] = useState(false);
  const chromeTimer = useRef<number | null>(null);

  const [art, setArt] = useState<ReleasePlaybackArt | null>(null);
  const [gallery, setGallery] = useState<
    { title?: string; url?: string; orientation?: string }[]
  >([]);
  const [vizExtras, setVizExtras] = useState<TrackVisualizerExtras | null>(null);
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [syncedLyrics, setSyncedLyrics] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [plainLyricsOpen, setPlainLyricsOpen] = useState(false);
  const plainScrollByTrack = useRef<Map<string, number>>(new Map());
  const plainScrollRef = useRef<HTMLDivElement>(null);

  /** Dual slots for true opacity crossfade (always both in DOM). */
  const [slots, setSlots] = useState<[BgLayer | null, BgLayer | null]>([
    null,
    null,
  ]);
  const [activeSlot, setActiveSlot] = useState(0);
  const activeSlotRef = useRef(0);
  const slotsRef = useRef(slots);
  activeSlotRef.current = activeSlot;
  slotsRef.current = slots;
  const [overlayMounted, setOverlayMounted] = useState(false);
  const [overlayShown, setOverlayShown] = useState(false);
  const stillIdx = useRef(0);
  const stillTimer = useRef<number | null>(null);
  const videoFailed = useRef(false);
  const swapRaf = useRef<number | null>(null);

  const touchStart = useRef<{ x: number; y: number; id: number } | null>(null);

  // Write beat vars onto the overlay root (it must not shadow :root with zeros).
  useBeatPulse(
    audioRef,
    Boolean(open && snap.playing),
    snap.playing,
    beatHosts
  );

  // Smooth overlay enter / exit.
  useEffect(() => {
    if (open) {
      setOverlayMounted(true);
      const id = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setOverlayShown(true));
      });
      return () => window.cancelAnimationFrame(id);
    }
    setOverlayShown(false);
    const t = window.setTimeout(() => setOverlayMounted(false), OVERLAY_FADE_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimer.current != null) window.clearTimeout(chromeTimer.current);
    if (!chromePinned) {
      chromeTimer.current = window.setTimeout(() => {
        setChromeVisible(false);
      }, CHROME_IDLE_MS);
    }
  }, [chromePinned]);

  useEffect(() => {
    if (!open) return;
    bumpChrome();
    return () => {
      if (chromeTimer.current != null) window.clearTimeout(chromeTimer.current);
    };
  }, [open, bumpChrome]);

  useEffect(() => {
    if (chromePinned) {
      setChromeVisible(true);
      if (chromeTimer.current != null) {
        window.clearTimeout(chromeTimer.current);
        chromeTimer.current = null;
      }
    } else if (open) {
      bumpChrome();
    }
  }, [chromePinned, open, bumpChrome]);

  // Close when queue clears.
  useEffect(() => {
    if (snap.visualizerOpen && !snap.hasTrack) {
      globalMusicSetVisualizerOpen(false);
    }
  }, [snap.visualizerOpen, snap.hasTrack]);

  // Load art + lyrics for current track (keep prior art until new arrives — avoids hard cuts).
  useEffect(() => {
    if (!open || !cur) return;
    let cancelled = false;
    videoFailed.current = false;
    setLyrics(null);
    setSyncedLyrics(null);
    setPlainLyricsOpen(false);

    const load = async () => {
      if (cur.artistId != null && cur.releaseId) {
        try {
          const res = await fetchTrackSourceArt(
            cur.artistId,
            cur.releaseId,
            cur.path
          );
          if (cancelled) return;
          setArt(res.playback || null);
          setGallery(res.artwork || []);
          setVizExtras(res.visualizer || null);
          preloadVisualizerStills(res.playback || null, res.visualizer, portrait);
        } catch {
          if (!cancelled) {
            setArt({
              cover_url: cur.coverUrl ?? null,
            });
            setGallery([]);
            setVizExtras(null);
          }
        }
      } else {
        setArt({ cover_url: cur.coverUrl ?? null });
        setGallery([]);
        setVizExtras(null);
      }

      setLyricsLoading(true);
      try {
        const ly = await fetchTrackLyrics(
          cur.artist || "",
          cur.title,
          cur.path,
          {
            bandId: cur.artistId ?? undefined,
            releaseId: cur.releaseId ?? undefined,
          }
        );
        if (cancelled) return;
        setLyrics(ly.lyrics ?? null);
        setSyncedLyrics(ly.synced_lyrics ?? null);
      } catch {
        if (!cancelled) {
          setLyrics(null);
          setSyncedLyrics(null);
        }
      } finally {
        if (!cancelled) setLyricsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, cur?.path, cur?.artistId, cur?.releaseId, cur?.title, cur?.artist, cur?.coverUrl, portrait]);

  // Soft-preload next queue track stills (deferred so current track stays snappy).
  useEffect(() => {
    if (!open || !snap.queue.length) return;
    const nextIdx = snap.index + 1;
    if (nextIdx < 0 || nextIdx >= snap.queue.length) return;
    const next = snap.queue[nextIdx] as GlobalMusicTrack | undefined;
    if (!next?.artistId || !next.releaseId) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void fetchTrackSourceArt(next.artistId!, next.releaseId!, next.path)
        .then((res) => {
          if (cancelled) return;
          preloadVisualizerStills(res.playback || null, res.visualizer, portrait);
        })
        .catch(() => {});
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, snap.index, snap.queue, portrait]);

  const eraPhotos = portrait
    ? vizExtras?.era_photos_portrait
    : vizExtras?.era_photos_landscape;

  const stills = useMemo(
    () => buildStills(art, gallery, portrait, eraPhotos),
    [art, gallery, portrait, eraPhotos]
  );

  const swapBg = useCallback((next: BgLayer) => {
    const curActive = activeSlotRef.current;
    const curLayer = slotsRef.current[curActive];
    if (curLayer && curLayer.url === next.url && curLayer.kind === next.kind) {
      return;
    }
    // First paint — no prior layer to crossfade from.
    if (!curLayer) {
      setSlots([next, null]);
      activeSlotRef.current = 0;
      setActiveSlot(0);
      return;
    }
    const inactive = (1 - curActive) as 0 | 1;
    // Paint new media into the hidden slot first, then flip active after a frame
    // so the browser paints opacity:0 before the fade-in starts.
    setSlots((prev) => {
      const copy: [BgLayer | null, BgLayer | null] = [prev[0], prev[1]];
      copy[inactive] = next;
      return copy;
    });
    if (swapRaf.current != null) window.cancelAnimationFrame(swapRaf.current);
    swapRaf.current = window.requestAnimationFrame(() => {
      swapRaf.current = window.requestAnimationFrame(() => {
        activeSlotRef.current = inactive;
        setActiveSlot(inactive);
        swapRaf.current = null;
      });
    });
  }, []);

  // Resolve background ladder for current art.
  useEffect(() => {
    if (!open) return;
    stillIdx.current = 0;
    if (stillTimer.current != null) {
      window.clearInterval(stillTimer.current);
      stillTimer.current = null;
    }

    const video = primaryVideo(art, portrait);
    if (video && !videoFailed.current) {
      swapBg({ key: `v:${video}`, kind: "video", url: video });
      return () => {
        if (stillTimer.current != null) {
          window.clearInterval(stillTimer.current);
          stillTimer.current = null;
        }
      };
    }

    if (!stills.length) {
      if (cur?.coverUrl) {
        swapBg({ key: `i:${cur.coverUrl}`, kind: "image", url: cur.coverUrl });
      }
      return;
    }

    const showStill = (idx: number) => {
      const url = stills[idx % stills.length]!;
      swapBg({ key: `i:${url}`, kind: "image", url });
    };
    showStill(0);
    if (stills.length > 1 && !prefersReducedMotion()) {
      stillTimer.current = window.setInterval(() => {
        stillIdx.current = (stillIdx.current + 1) % stills.length;
        showStill(stillIdx.current);
      }, STILL_CROSSFADE_MS);
    }
    // Do not cancel swapRaf here — that aborted mid-crossfade on stills rebuild.
    return () => {
      if (stillTimer.current != null) {
        window.clearInterval(stillTimer.current);
        stillTimer.current = null;
      }
    };
  }, [open, art, portrait, stills, swapBg, cur?.coverUrl]);

  // Pause visualizer video when tab is hidden (not window blur).
  useEffect(() => {
    if (!open) return;
    const onVis = () => {
      const active = videoRefs.current[activeSlotRef.current];
      if (!active) return;
      if (document.hidden) {
        for (const v of videoRefs.current) v?.pause();
      } else if (slotsRef.current[activeSlotRef.current]?.kind === "video") {
        void active.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [open]);

  // Tear down pending swaps when overlay closes.
  useEffect(() => {
    if (open) return;
    if (swapRaf.current != null) {
      window.cancelAnimationFrame(swapRaf.current);
      swapRaf.current = null;
    }
  }, [open]);

  // Keyboard shortcuts while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        globalMusicSetVisualizerOpen(false);
        return;
      }
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        globalMusicToggle();
        bumpChrome();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        globalMusicPrev();
        bumpChrome();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        globalMusicNext();
        bumpChrome();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        globalMusicSetVolume(Math.min(1, snap.volume + 0.05));
        bumpChrome();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        globalMusicSetVolume(Math.max(0, snap.volume - 0.05));
        bumpChrome();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, bumpChrome, snap.volume]);

  const onVideoError = () => {
    videoFailed.current = true;
    if (stills.length) {
      swapBg({ key: `i:${stills[0]}`, kind: "image", url: stills[0]! });
    } else if (cur?.coverUrl) {
      swapBg({ key: `i:${cur.coverUrl}`, kind: "image", url: cur.coverUrl });
    }
  };

  const lrcLines = useMemo(
    () => (syncedLyrics ? parseLrc(syncedLyrics) : []),
    [syncedLyrics]
  );

  const activeLrcIdx = useMemo(() => {
    if (!lrcLines.length) return -1;
    let idx = -1;
    for (let i = 0; i < lrcLines.length; i++) {
      if (lrcLines[i]!.time <= snap.progress + 0.05) idx = i;
      else break;
    }
    return idx;
  }, [lrcLines, snap.progress]);

  const syncedWindow = useMemo(() => {
    if (activeLrcIdx < 0) return null;
    const active = lrcLines[activeLrcIdx];
    if (!active?.text.trim()) return null;
    return {
      prev: activeLrcIdx > 0 ? lrcLines[activeLrcIdx - 1]!.text : null,
      active: active.text,
      next:
        activeLrcIdx + 1 < lrcLines.length
          ? lrcLines[activeLrcIdx + 1]!.text
          : null,
    };
  }, [activeLrcIdx, lrcLines]);

  const pct =
    snap.duration > 0
      ? Math.min(100, Math.max(0, (snap.progress / snap.duration) * 100))
      : 0;

  const coverSrc =
    art?.cover_animation_url && isVideoMediaUrl(art.cover_animation_url)
      ? art.cover_animation_url
      : art?.cover_url || cur?.coverUrl || null;
  const coverIsVideo = Boolean(
    coverSrc && isVideoMediaUrl(coverSrc)
  );
  const discSrc = art?.disc_url || null;
  const spinDisc = art?.group_kind !== "side" && Boolean(discSrc) && snap.playing;

  const onBgPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      touchStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    }
  };

  const onBgPointerUp = (e: ReactPointerEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || start.id !== e.pointerId) {
      // Mouse / tap without swipe — toggle chrome on touch.
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        if (chromeVisible && !chromePinned) setChromeVisible(false);
        else bumpChrome();
      }
      return;
    }
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) {
      if (chromeVisible && !chromePinned) setChromeVisible(false);
      else bumpChrome();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= SWIPE_MIN_PX) {
      if (dx < 0) globalMusicNext();
      else globalMusicPrev();
      bumpChrome();
      return;
    }
    if (Math.abs(dy) > Math.abs(dx) && dy >= SWIPE_MIN_PX) {
      globalMusicSetVisualizerOpen(false);
    }
  };

  // Restore plain lyrics scroll per track.
  useEffect(() => {
    if (!plainLyricsOpen || !cur || !plainScrollRef.current) return;
    const y = plainScrollByTrack.current.get(cur.path) ?? 0;
    plainScrollRef.current.scrollTop = y;
  }, [plainLyricsOpen, cur?.path]);

  if (!overlayMounted || !cur) return null;

  const hasPlain = Boolean(lyrics && !syncedLyrics);
  const showSynced = Boolean(syncedWindow);
  const displayTitle = portrait
    ? cur.title
    : trackMainTitle(cur.title) || cur.title;

  return createPortal(
      <div
        ref={rootRef}
        className={`music-visualizer${overlayShown ? " is-shown" : ""}${
          chromeVisible ? " is-chrome" : ""
        }${portrait ? " is-portrait" : " is-landscape"}`}
        role="dialog"
        aria-modal="true"
        aria-label="Now playing visualizer"
        onMouseMove={() => {
          bumpChrome();
        }}
      >
        <button
          type="button"
          className="music-visualizer__exit"
          aria-label="Exit visualizer"
          title="Exit visualizer"
          onClick={() => globalMusicSetVisualizerOpen(false)}
        >
          <IconVisualizer />
        </button>

        <div
          className="music-visualizer__bg"
          onPointerDown={onBgPointerDown}
          onPointerUp={onBgPointerUp}
          onPointerCancel={() => {
            touchStart.current = null;
          }}
        >
          {([0, 1] as const).map((i) => {
            const layer = slots[i];
            if (!layer) return null;
            const isActive = activeSlot === i;
            return (
              <div
                key={i}
                className={`music-visualizer__layer music-visualizer__layer--${layer.kind}${
                  isActive ? " is-active" : ""
                }`}
                style={
                  layer.kind === "image"
                    ? ({
                        backgroundImage: `url("${layer.url}")`,
                      } as CSSProperties)
                    : undefined
                }
              >
                {layer.kind === "video" ? (
                  <video
                    ref={(el) => {
                      videoRefs.current[i] = el;
                    }}
                    src={layer.url}
                    autoPlay={isActive}
                    loop
                    muted
                    playsInline
                    onError={onVideoError}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="music-visualizer__beat" aria-hidden />

        {showSynced ? (
          <div className="music-visualizer__synced" aria-live="polite">
            {syncedWindow!.prev ? (
              <p className="music-visualizer__synced-line music-visualizer__synced-line--near">
                {syncedWindow!.prev}
              </p>
            ) : (
              <p className="music-visualizer__synced-line music-visualizer__synced-line--near" />
            )}
            <p className="music-visualizer__synced-line music-visualizer__synced-line--active">
              {syncedWindow!.active}
            </p>
            {syncedWindow!.next ? (
              <p className="music-visualizer__synced-line music-visualizer__synced-line--near">
                {syncedWindow!.next}
              </p>
            ) : (
              <p className="music-visualizer__synced-line music-visualizer__synced-line--near" />
            )}
          </div>
        ) : null}

        {hasPlain && plainLyricsOpen ? (
          <div
            className="music-visualizer__plain is-open"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              ref={plainScrollRef}
              className="music-visualizer__plain-scroll ms-scrollbar"
              onScroll={(e) => {
                if (!cur) return;
                plainScrollByTrack.current.set(
                  cur.path,
                  e.currentTarget.scrollTop
                );
              }}
            >
              {lyricsLoading ? (
                <p className="muted">Loading lyrics…</p>
              ) : (
                <pre>{lyrics}</pre>
              )}
            </div>
          </div>
        ) : null}

        {hasPlain ? (
          <button
            type="button"
            className={`music-visualizer__lyrics-toggle${
              plainLyricsOpen ? " is-active" : ""
            }`}
            aria-label={plainLyricsOpen ? "Hide lyrics" : "Show lyrics"}
            aria-pressed={plainLyricsOpen}
            title={plainLyricsOpen ? "Hide lyrics" : "Show lyrics"}
            onClick={(e) => {
              e.stopPropagation();
              setPlainLyricsOpen((v) => !v);
              bumpChrome();
            }}
          >
            <IconLyrics />
          </button>
        ) : null}

        <div
          className={`music-visualizer__chrome${
            chromeVisible ? " is-visible" : ""
          }`}
          onMouseEnter={() => setChromePinned(true)}
          onMouseLeave={() => setChromePinned(false)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="music-visualizer__chrome-dim" aria-hidden />
          <div className="music-visualizer__chrome-inner">
            <div className="music-visualizer__meta">
              <div
                className={`music-visualizer__art-stack${
                  art?.group_kind === "side" ? " is-vinyl" : ""
                }${spinDisc ? " is-spinning" : ""}`}
              >
                {coverSrc ? (
                  coverIsVideo ? (
                    <video
                      className="music-visualizer__cover"
                      src={coverSrc}
                      autoPlay
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      className="music-visualizer__cover"
                      src={coverSrc}
                      alt=""
                      draggable={false}
                    />
                  )
                ) : (
                  <span className="music-visualizer__cover music-visualizer__cover--empty" />
                )}
                {discSrc ? (
                  <img
                    className="music-visualizer__disc"
                    src={discSrc}
                    alt=""
                    draggable={false}
                  />
                ) : null}
              </div>
              <div className="music-visualizer__text">
                <p className="music-visualizer__title">{displayTitle}</p>
                <div className="music-visualizer__artist">
                  {(() => {
                    const icon =
                      vizExtras?.era_icon_url || art?.icon_url || null;
                    const logo =
                      vizExtras?.era_logo_url || art?.logo_url || null;
                    const label =
                      vizExtras?.subject_artist ||
                      cur.artist ||
                      "Unknown artist";
                    return (
                      <>
                        {icon ? (
                          <img
                            className="music-visualizer__artist-icon"
                            src={icon}
                            alt=""
                            draggable={false}
                          />
                        ) : null}
                        {logo ? (
                          <img
                            className="music-visualizer__artist-logo"
                            src={logo}
                            alt={label}
                            draggable={false}
                          />
                        ) : (
                          <span>{label}</span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            <div className="music-visualizer__transport">
              <button
                type="button"
                className="music-visualizer__skip music-visualizer__skip--prev"
                aria-label="Previous track"
                onClick={() => globalMusicPrev()}
              />
              <button
                type="button"
                className="music-visualizer__play"
                aria-label={snap.playing ? "Pause" : "Play"}
                onClick={() => globalMusicToggle()}
              >
                {snap.playing ? (
                  <span className="music-visualizer__pause" />
                ) : (
                  <span className="music-visualizer__triangle" />
                )}
              </button>
              <button
                type="button"
                className="music-visualizer__skip music-visualizer__skip--next"
                aria-label="Next track"
                onClick={() => globalMusicNext()}
              />
            </div>

            <div className="music-visualizer__chrome-spacer" aria-hidden />
          </div>

          <div
            className="music-visualizer__seek"
            role="group"
            aria-label="Track progress"
          >
            <input
              type="range"
              className="music-visualizer__seek-input"
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
        </div>
      </div>,
    document.body
  );
}
