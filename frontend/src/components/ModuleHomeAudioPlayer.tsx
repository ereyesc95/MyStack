import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  fetchBooksBookPlayerTracks,
  fetchBooksHomeAudioPool,
  fetchGamesGamePlayerTracks,
  fetchGamesHomeAudioPool,
  fetchHobbyFranchiseAudioPool,
  fetchMoviesFilmPlayerTracks,
  fetchMoviesHomeAudioPool,
  fetchSeriesHomeAudioPool,
  fetchSeriesPlayerTracks,
} from "../api";
import {
  getGlobalMusicSnapshot,
  globalMusicAdoptContext,
  subscribeGlobalMusic,
  type GlobalMusicTrack,
} from "../globalMusicPlayer";
import { musicStreamUrl } from "../musicStreamUrl";
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
   * When set, load a franchise soundtrack pool instead of the module-wide home pool.
   */
  franchiseName?: string | null;
  /** Prefer franchise id player-tracks when available (Series). */
  franchiseId?: string | null;
  /**
   * Leaf id (subseries / film / book / game). Prefer leaf Audio/, then
   * fall back to franchise / name pool.
   */
  leafId?: string | null;
  enabled?: boolean;
  /** @deprecated Bubble UI removed — kept for call-site compatibility. */
  hideToggle?: boolean;
  /** @deprecated Bubble UI removed. */
  open?: boolean;
  /** @deprecated Bubble UI removed. */
  onOpenChange?: (open: boolean) => void;
  userId?: number;
  onOpenMusicRelease?: (bandId: number, releaseId: string) => void;
  onOpenMusicArtist?: (bandId: number) => void;
  onOpenSourceLeaf?: (source: ModuleHomeAudioSource) => void;
  onPlayingChange?: (playing: boolean) => void;
  onCoverChange?: (coverUrl: string | null) => void;
  onHasSrcChange?: (hasSrc: boolean) => void;
};

function playUrlFor(track: Track): string | null {
  if (track.play_url) return track.play_url;
  if (track.play_path) return musicStreamUrl(track.play_path);
  return null;
}

function toGlobalTracks(list: Track[]): GlobalMusicTrack[] {
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
  return mapped;
}

function mapPlayerTracks(
  tracks: {
    id: string;
    title: string;
    play_url?: string;
    play_path?: string | null;
    cover_url?: string | null;
    artist?: string | null;
    navigate_band_id?: number | null;
    navigate_release_id?: string | null;
    release_title?: string | null;
  }[]
): Track[] {
  return (tracks || []).map((t) => ({
    id: t.id,
    title: t.title,
    play_url: t.play_url,
    play_path: t.play_path ?? null,
    cover_url: t.cover_url,
    artist: t.artist,
    navigate_band_id: t.navigate_band_id,
    navigate_release_id: t.navigate_release_id,
    release_title: t.release_title,
  }));
}

async function loadPool(
  module: ModuleHomeAudioKind,
  franchiseName?: string | null,
  franchiseId?: string | null,
  leafId?: string | null
): Promise<Track[]> {
  const lid = (leafId || "").trim();
  const fid = (franchiseId || "").trim();

  if (lid) {
    try {
      if (module === "movies") {
        const data = await fetchMoviesFilmPlayerTracks(lid);
        const mapped = mapPlayerTracks(data.tracks || []);
        if (mapped.length) return mapped;
      } else if (module === "books") {
        const data = await fetchBooksBookPlayerTracks(lid);
        const mapped = mapPlayerTracks(data.tracks || []);
        if (mapped.length) return mapped;
      } else if (module === "games") {
        const data = await fetchGamesGamePlayerTracks(lid);
        const mapped = mapPlayerTracks(data.tracks || []);
        if (mapped.length) return mapped;
      } else if (module === "series" && fid) {
        const data = await fetchSeriesPlayerTracks(fid, lid);
        const mapped = mapPlayerTracks(data.tracks || []);
        if (mapped.length) return mapped;
      }
    } catch {
      /* fall through to franchise / home */
    }
  }

  if (fid && module === "series") {
    try {
      const data = await fetchSeriesPlayerTracks(fid);
      const mapped = mapPlayerTracks(data.tracks || []);
      if (mapped.length) return mapped;
    } catch {
      /* fall through */
    }
  }

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

/**
 * Headless sync: loads module / franchise / leaf soundtrack pools into the
 * global music bar (no autoplay). Keeps cover/playing callbacks for home
 * backdrop FX.
 */
export default function ModuleHomeAudioPlayer({
  module,
  franchiseName = null,
  franchiseId = null,
  leafId = null,
  enabled = true,
  onPlayingChange,
  onCoverChange,
  onHasSrcChange,
}: Props) {
  const adoptedKeyRef = useRef<string>("");
  const globalMusic = useSyncExternalStore(
    subscribeGlobalMusic,
    getGlobalMusicSnapshot,
    getGlobalMusicSnapshot
  );
  const playing = globalMusic.playing;
  const hasSrc = globalMusic.hasTrack;

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  useEffect(() => {
    onHasSrcChange?.(hasSrc);
  }, [hasSrc, onHasSrcChange]);

  useEffect(() => {
    onCoverChange?.(globalMusic.current?.coverUrl ?? null);
  }, [globalMusic.current?.coverUrl, onCoverChange]);

  useEffect(() => {
    return () => {
      // Don't force playing=false on unmount — a sibling page's player may
      // take over while global audio keeps running uninterrupted.
      onCoverChange?.(null);
      onHasSrcChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const leaf = (leafId || "").trim();
    const contextKey = leaf
      ? `${module}:leaf:${leaf}`
      : franchiseId
        ? `${module}:franchise:${franchiseId}`
        : franchiseName
          ? `${module}:name:${franchiseName.trim().toLowerCase()}`
          : `${module}:home`;

    void loadPool(module, franchiseName, franchiseId, leafId)
      .then((list) => {
        if (cancelled) return;
        const mapped = toGlobalTracks(list);
        if (!mapped.length) return;
        adoptedKeyRef.current = contextKey;
        globalMusicAdoptContext(mapped, { contextKey, peek: true });
      })
      .catch(() => {
        /* quiet */
      });

    return () => {
      cancelled = true;
    };
  }, [module, franchiseName, franchiseId, leafId, enabled]);

  return null;
}
