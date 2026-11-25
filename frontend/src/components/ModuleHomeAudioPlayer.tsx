import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  fetchBooksHomeAudioPool,
  fetchGamesHomeAudioPool,
  fetchHobbyFranchiseAudioPool,
  fetchMoviesHomeAudioPool,
  fetchSeriesHomeAudioPool,
} from "../api";
import {
  getGlobalMusicAudioElement,
  getGlobalMusicSnapshot,
  globalMusicNext,
  globalMusicPlayFrom,
  globalMusicPrev,
  globalMusicSeekRatio,
  globalMusicToggle,
  globalMusicToggleRepeatOne,
  subscribeGlobalMusic,
  type GlobalMusicTrack,
} from "../globalMusicPlayer";
import { musicStreamUrl } from "../musicStreamUrl";
import { useBeatPulse } from "../useBeatPulse";
import { IconMediaMusic } from "./MenuIcons";
import { MiniAudioPlayerControls } from "./music/artist/MiniAudioPlayer";
import { trackMainTitle } from "./music/release/releaseTrackPanelMeta";

export type ModuleHomeAudioKind = "series" | "movies" | "books" | "games";

type Track = {
  id: string;
  title: string;
  play_url?: string;
  play_path?: string | null;
  cover_url?: string | null;
  artist?: string | null;
  navigate_band_id?: number | null;
  navigate_release_id?: string | null;
  release_title?: string | null;
  source_module?: ModuleHomeAudioKind | string | null;
  source_title?: string | null;
  source_franchise_id?: string | null;
  source_leaf_id?: string | null;
};

export type ModuleHomeAudioSource = {
  module: ModuleHomeAudioKind;
  title: string;
  franchiseId: string;
  leafId?: string | null;
};

type Props = {
  module: ModuleHomeAudioKind;
  /**
   * When set (HobbyStack limited Franchise meta), load a cross-module
   * franchise soundtrack pool instead of the module-wide home pool.
   */
  franchiseName?: string | null;
  enabled?: boolean;
  hideToggle?: boolean;
  /** Controlled open (portrait menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  userId?: number;
  onOpenMusicRelease?: (bandId: number, releaseId: string) => void;
  onOpenMusicArtist?: (bandId: number) => void;
  /** Open the leaf that owns the soundtrack .lnk (game/film/book/show). */
  onOpenSourceLeaf?: (source: ModuleHomeAudioSource) => void;
  onPlayingChange?: (playing: boolean) => void;
  onCoverChange?: (coverUrl: string | null) => void;
  onHasSrcChange?: (hasSrc: boolean) => void;
};

async function loadPool(
  module: ModuleHomeAudioKind,
  franchiseName?: string | null
): Promise<Track[]> {
  const franchise = (franchiseName || "").trim();
  if (franchise) {
    const data = await fetchHobbyFranchiseAudioPool(franchise);
    return (data.tracks || []) as Track[];
  }
  const data =
    module === "movies"
      ? await fetchMoviesHomeAudioPool()
      : module === "books"
        ? await fetchBooksHomeAudioPool()
        : module === "games"
          ? await fetchGamesHomeAudioPool()
          : await fetchSeriesHomeAudioPool();
  return (data.tracks || []) as Track[];
}

function playUrlFor(track: Track): string | null {
  if (track.play_url) return track.play_url;
  if (track.play_path) return musicStreamUrl(track.play_path);
  return null;
}

/**
 * Top-bar bubble for Series/Movies/Books/Games home chrome.
 * Prefetches a 10-track pool in the background; icon appears when ready.
 * Applies adaptive cover theme + reports cover/playing for parent backdrop FX.
 */
export default function ModuleHomeAudioPlayer({
  module,
  franchiseName = null,
  enabled = true,
  hideToggle = false,
  open: openProp,
  onOpenChange,
  onOpenMusicRelease,
  onOpenMusicArtist,
  onOpenSourceLeaf,
  onPlayingChange,
  onCoverChange,
  onHasSrcChange,
}: Props) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    if (openProp === undefined) setOpenInternal(value);
    onOpenChange?.(value);
  };
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const queueRef = useRef<Track[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const dockPortalRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const coverRef = useRef<string | null>(null);
  const globalMusic = useSyncExternalStore(
    subscribeGlobalMusic,
    getGlobalMusicSnapshot,
    getGlobalMusicSnapshot
  );
  const globalAudioRef = useRef<HTMLAudioElement | null>(null);
  globalAudioRef.current = getGlobalMusicAudioElement();
  const playing = globalMusic.playing;
  const hasSrc = globalMusic.hasTrack;

  useBeatPulse(
    globalAudioRef,
    Boolean(enabled && tracks.length && (open || playing || hasSrc)),
    Boolean(playing)
  );

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  useEffect(() => {
    onHasSrcChange?.(hasSrc);
  }, [hasSrc, onHasSrcChange]);

  useEffect(() => {
    coverRef.current = globalMusic.current?.coverUrl ?? null;
    onCoverChange?.(coverRef.current);
  }, [globalMusic.current?.coverUrl, onCoverChange]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    void loadPool(module, franchiseName)
      .then((list) => {
        if (cancelled) return;
        setTracks(list);
        queueRef.current = list;
        loadedRef.current = true;
      })
      .catch(() => {
        if (cancelled) return;
        setTracks([]);
        queueRef.current = [];
        loadedRef.current = false;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [module, franchiseName, enabled]);

  useEffect(() => {
    return () => {
      onCoverChange?.(null);
      onPlayingChange?.(false);
      onHasSrcChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (dockPortalRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const playAt = useCallback((i: number, list: Track[]) => {
    const mapped: GlobalMusicTrack[] = [];
    for (const t of list) {
      const path = (t.play_path || "").trim();
      const url = playUrlFor(t);
      if (!path && !url) continue;
      mapped.push({
        id: path || url!,
        path: path || url!,
        title: trackMainTitle(t.title) || t.title || "Track",
        artist: t.artist ?? null,
        artistId: t.navigate_band_id ?? null,
        releaseId: t.navigate_release_id ?? null,
        releaseTitle: t.release_title ?? null,
        coverUrl: t.cover_url ?? null,
        playUrl: t.play_url ?? (path ? musicStreamUrl(path) : url),
      });
    }
    if (!mapped.length) return;
    const start = Math.max(0, Math.min(i, mapped.length - 1));
    globalMusicPlayFrom(mapped, start);
  }, []);

  if (!enabled) return null;
  // Keep chrome quiet until we know there is something to play.
  if (!loading && tracks.length === 0) return null;

  const nowPath = globalMusic.current?.path;
  const now =
    tracks.find((t) => t.play_path === nowPath) ||
    tracks.find((t) => playUrlFor(t) === globalMusic.current?.playUrl) ||
    tracks[0];
  const artistLabel = (now?.artist || globalMusic.current?.artist || "").trim();
  const sourceTitle = (now?.source_title || "").trim();
  const sourceFranchiseId = (now?.source_franchise_id || "").trim();
  const sourceModule = (now?.source_module || module) as ModuleHomeAudioKind;
  const canOpenRelease = Boolean(
    (now?.navigate_band_id || globalMusic.current?.artistId) &&
      (now?.navigate_release_id || globalMusic.current?.releaseId) &&
      onOpenMusicRelease
  );
  const canOpenArtist = Boolean(
    (now?.navigate_band_id || globalMusic.current?.artistId) && onOpenMusicArtist
  );
  const canOpenSource = Boolean(
    sourceTitle && sourceFranchiseId && onOpenSourceLeaf
  );

  const dockBody = loading && !tracks.length ? (
    <span className="muted">Loading tracks…</span>
  ) : (
    <>
      <div className="series-audio-player__now">
        {(now?.cover_url || globalMusic.current?.coverUrl) ? (
          canOpenRelease ? (
            <button
              type="button"
              className="series-audio-player__cover-btn"
              title="Go to release"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenMusicRelease?.(
                  Number(now?.navigate_band_id || globalMusic.current?.artistId),
                  String(
                    now?.navigate_release_id || globalMusic.current?.releaseId
                  )
                );
              }}
            >
              <img
                src={now?.cover_url || globalMusic.current?.coverUrl || ""}
                alt=""
              />
            </button>
          ) : (
            <img
              src={now?.cover_url || globalMusic.current?.coverUrl || ""}
              alt=""
            />
          )
        ) : null}
        <div>
          <strong>
            {globalMusic.current?.title ||
              (now?.title ? trackMainTitle(now.title) : "Now playing")}
          </strong>
          {artistLabel ? (
            canOpenArtist ? (
              <button
                type="button"
                className="series-audio-player__artist-link"
                title="Go to artist"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenMusicArtist?.(
                    Number(
                      now?.navigate_band_id || globalMusic.current?.artistId
                    )
                  );
                }}
              >
                {artistLabel}
              </button>
            ) : (
              <span className="muted">{artistLabel}</span>
            )
          ) : null}
          {sourceTitle ? (
            canOpenSource ? (
              <button
                type="button"
                className="series-audio-player__source-link"
                title={`Go to ${sourceTitle}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenSourceLeaf?.({
                    module: sourceModule,
                    title: sourceTitle,
                    franchiseId: sourceFranchiseId,
                    leafId: now?.source_leaf_id || null,
                  });
                }}
              >
                {sourceTitle}
              </button>
            ) : (
              <span className="series-audio-player__source-line muted">
                {sourceTitle}
              </span>
            )
          ) : null}
        </div>
      </div>
      <MiniAudioPlayerControls
        playing={playing}
        progress={globalMusic.progress}
        duration={globalMusic.duration}
        toggle={() => {
          if (!hasSrc && tracks.length) {
            playAt(0, tracks);
            return;
          }
          globalMusicToggle();
        }}
        seek={(v) => globalMusicSeekRatio(v / 100)}
        onPrev={() => globalMusicPrev()}
        onNext={() => globalMusicNext()}
        repeatOne={globalMusic.repeatOne}
        onRepeatToggle={() => globalMusicToggleRepeatOne()}
      />
    </>
  );

  const dock = open ? (
    <div className="series-audio-player__dock">{dockBody}</div>
  ) : null;

  return (
    <>
      <div
        ref={rootRef}
        className={`series-audio-player${open && !hideToggle ? " is-open" : ""}${
          hideToggle ? " series-audio-player--menu-anchor" : ""
        }`}
      >
        {!hideToggle ? (
          <button
            type="button"
            className={`series-audio-player__toggle${
              playing && !open ? " series-audio-player__toggle--live" : ""
            }`}
            aria-pressed={open}
            aria-label={open ? "Hide player" : "Show player"}
            title={open ? "Hide player" : "Show player"}
            disabled={loading && !tracks.length}
            onClick={() => {
              const next = !open;
              setOpen(next);
              if (next && tracks.length && !hasSrc) {
                playAt(0, tracks);
              }
            }}
          >
            <IconMediaMusic className="series-audio-player__icon" />
          </button>
        ) : null}
        {open && !hideToggle ? dock : null}
      </div>
      {open && hideToggle
        ? createPortal(
            <div
              ref={dockPortalRef}
              className="series-audio-player series-audio-player--menu-only is-open"
            >
              {dock}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
