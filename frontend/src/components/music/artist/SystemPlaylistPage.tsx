import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  fetchGlobalLiveShowsDetail,
  fetchTrackSourceArt,
  resolveArtistName,
  uploadUserPlaylistCover,
  updateUserPlaylist,
  deleteUserPlaylist,
  fetchPlaylistSubgenres,
  fetchFilterOptions,
} from "../../../api";
import {
  getGlobalMusicAudioElement,
  getGlobalMusicSnapshot,
  globalMusicPause,
  globalMusicPlayFrom,
  globalMusicSeekRatio,
  globalMusicToggle,
  subscribeGlobalMusic,
  type GlobalMusicTrack,
} from "../../../globalMusicPlayer";
import { getCachedOverview, prefetchBandOverview } from "../../../overviewCache";
import {
  getCachedArtistPlaylistDetail,
  prefetchArtistPlaylistDetail,
} from "../../../artistPlaylistDetailCache";
import {
  getCachedUserPlaylistDetail,
  prefetchUserPlaylistDetail,
  clearUserPlaylistDetailCache,
} from "../../../userPlaylistDetailCache";
import { prefetchTrackCredits, getCachedTrackCredits } from "../../../releaseTrackCreditsCache";
import { pushArtistRoute, pushUserPlaylistRoute } from "../../../musicRoute";
import {
  getWrappedPlaylistEntry,
  takeWrappedPlaylistEntry,
} from "../../../wrappedPlaylistNav";
import {
  applyAlbumTheme,
  applyMediaTheme,
  beginAdaptivePageSession,
  beginAlbumPageSession,
  beginArtistPageSession,
  clearAlbumTheme,
  clearMediaTheme,
  clearUserPlaylistPageTheme,
  colorsFromImageUrl,
} from "../../../mediaTheme";
import {
  buildLiveShowsArtistSections,
  buildUniqueLiveTracks,
  nextLiveShowsViewMode,
  type LiveShowsViewMode,
} from "../../../liveShowsTransform";
import {
  isMobileLandscapeLayout,
  isMobilePortraitLayout,
  isTabletLayout,
  useDeviceLayout,
} from "../../../usePhoneLayout";
import { useBeatPulse } from "../../../useBeatPulse";
import { formatTrackDate } from "../../../formatDate";
import { isVideoMediaUrl as isVideoMedia } from "../../../isVideoMediaUrl";
import type {
  ArtistPlaylistDetail,
  ArtistPlaylistTrack,
  BandOverview,
  ReleaseTrackItem,
} from "../../../types";
import PlaylistBoot from "../../PlaylistBoot";
import ConfirmDialog from "../../ConfirmDialog";
import MsDisclosure from "../../MsDisclosure";
import TopBarTitle from "../../TopBarTitle";
import { systemPlaylistCoverUrl } from "./ArtistPlaylists";
import MediaBeatFx from "../MediaBeatFx";
import SystemPlaylistTracklist, {
  type SystemPlaylistTracklistHandle,
} from "./SystemPlaylistTracklist";
import SnapshotPlaylistFilterBar from "../SnapshotPlaylistFilterBar";
import ReimportCsvModal from "../ReimportCsvModal";
import {
  applySnapshotFilters,
  applyTrackSort,
  dedupeTracksByPlayPath,
  titleCaseWords,
  type PlaylistTrackSortKey,
  type SnapshotFilterState,
} from "../playlistTrackSort";
import { trackMainTitle } from "../release/releaseTrackPanelMeta";
import { youtubeVideoId } from "../../../utils/youtube";
import SetlistsPlaylistContent, {
  type SetlistsPlaylistHandle,
} from "./SetlistsPlaylistContent";
import type { ReleaseMobileTrackView, ReleasePlaybackArt } from "../release/ReleaseTracklist";
import {
  ChevronIcon,
  DEFAULT_DISC_URL,
  DEFAULT_LABEL_URL,
  isAdaptationLine,
  parseTrackPanelMeta,
  playlistTrackVersionSource,
  primaryArtistName,
  writerSearchUrl,
} from "../release/releaseTrackPanelMeta";
import {
  TrackActionLyricsIcon,
  TrackActionPlaylistIcon,
  TrackActionVersionsIcon,
} from "../release/releaseTrackActionIcons";
import MediaBeatFrame from "../MediaBeatFrame";
import AppMenu from "../../AppMenu";
import MediaInlineSearch from "../MediaInlineSearch";
import {
  IconByArtist,
  IconByShow,
  IconList,
  IconMediaBooks,
  IconMediaGames,
  IconMediaMovies,
  IconMediaMusic,
  IconMediaSeries,
} from "../../MenuIcons";

const WRAPPED_MODULE_META: Record<
  string,
  { label: string; Icon: typeof IconMediaMusic }
> = {
  music: { label: "Music", Icon: IconMediaMusic },
  series: { label: "Series", Icon: IconMediaSeries },
  movies: { label: "Movies", Icon: IconMediaMovies },
  books: { label: "Books", Icon: IconMediaBooks },
  games: { label: "Games", Icon: IconMediaGames },
};

type PanelBrand = {
  bandId: number;
  name: string;
  iconUrl: string | null;
  logoUrl: string | null;
  inLibrary: boolean;
};

function eraBrandingFromOverview(
  overview: BandOverview | null | undefined,
  dateIso: string | null | undefined
): { iconUrl: string | null; logoUrl: string | null } {
  if (!overview) return { iconUrl: null, logoUrl: null };
  const year = dateIso ? Number(String(dateIso).slice(0, 4)) : NaN;
  const era =
    Number.isFinite(year) && year > 0
      ? overview.eras?.find((entry) => entry.year === year)
      : null;
  return {
    iconUrl:
      era?.icon_url ?? overview.eras?.find((entry) => entry.icon_url)?.icon_url ?? null,
    logoUrl:
      era?.logo_url ??
      overview.eras?.find((entry) => entry.logo_url)?.logo_url ??
      overview.eras?.[0]?.logo_url ??
      null,
  };
}

type Props = {
  bandId?: number;
  slug?: string;
  userPlaylistId?: number;
  userId?: number;
  isAdmin?: boolean;
  onBack: () => void;
  onPlaylistDeleted?: () => void;
  onOpenPlaylist: (key: string) => void;
  onOpenRelease?: (bandId: number, releaseId: string) => void;
  onOpenArtist?: (bandId: number) => void;
  onOpenShow?: (target: {
    bandId: number;
    tourSlug: string;
    showSlug: string;
    bandName?: string | null;
  }) => void;
  onOpenCatalogSubgenre?: (subgenreId: number, subgenreName?: string) => void;
  onImport: () => void;
  onSync: () => void;
  onChooseSource: () => void;
  onSwitchProfile: () => void;
  onEditProfile: () => void;
  /** Music home → Playlists: all-artists live shows aggregate. */
  catalogLiveShows?: boolean;
  /** Back button label when opened from Events / Playlists. */
  backLabel?: string;
};

function dedupeMusicVideoTracks(tracks: ArtistPlaylistTrack[]): ArtistPlaylistTrack[] {
  const seen = new Set<string>();
  const out: ArtistPlaylistTrack[] = [];
  for (const track of tracks) {
    const titleKey = trackMainTitle(track.title).trim().toLowerCase();
    const local = track.local_video_path?.trim();
    const videoKey = local
      ? `local:${local.toLowerCase()}`
      : youtubeVideoId(track.video_url ?? track.youtube_url ?? "") ??
        (track.video_url ?? track.youtube_url ?? "").trim().toLowerCase();
    if (!titleKey || !videoKey) {
      out.push(track);
      continue;
    }
    const date = (track.video_release_date ?? track.video_release_year ?? "").trim();
    const label = (track.video_label ?? "").trim().toLowerCase();
    const key = `${titleKey}|${videoKey}|${date}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
  }
  return out;
}

function coverUrlFallback(tracks: ArtistPlaylistTrack[]): string | undefined {
  return tracks.find((t) => t.cover_url)?.cover_url ?? undefined;
}

const DEFAULT_USER_PLAYLIST_COVER = "/api/assets/default/playlist";

function splitSnapshotGenres(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(",").map((g) => g.trim()).filter(Boolean);
}

function SnapshotStatsPanel({
  snapshot,
  mobile,
}: {
  snapshot: NonNullable<ArtistPlaylistTrack["snapshot"]>;
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rows: { label: string; value: string }[] = [];
  if (snapshot.popularity != null) rows.push({ label: "Popularity", value: String(snapshot.popularity) });
  if (snapshot.tempo != null) rows.push({ label: "Tempo", value: `${Math.round(snapshot.tempo)} BPM` });
  if (snapshot.energy != null) rows.push({ label: "Energy", value: `${Math.round(snapshot.energy * 100)}%` });
  if (snapshot.danceability != null) {
    rows.push({ label: "Danceability", value: `${Math.round(snapshot.danceability * 100)}%` });
  }
  if (snapshot.valence != null) rows.push({ label: "Valence", value: `${Math.round(snapshot.valence * 100)}%` });
  if (snapshot.acousticness != null) {
    rows.push({ label: "Acousticness", value: `${Math.round(snapshot.acousticness * 100)}%` });
  }
  if (snapshot.instrumentalness != null) {
    rows.push({ label: "Instrumentalness", value: `${Math.round(snapshot.instrumentalness * 100)}%` });
  }
  if (!rows.length) return null;
  return (
    <div className="release-page__snapshot-stats">
      <button
        type="button"
        className="release-page__snapshot-stats-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {mobile ? "Stats" : "Statistics"}
        <span className="release-page__snapshot-stats-chev" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <ul className="release-page__snapshot-stats-list">
          {rows.map((row) => (
            <li key={row.label}>
              <span>{row.label}</span>
              <span>{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MULTI_ARTIST_PLAYLIST_SLUGS = new Set([
  "tributes",
  "appearances",
  "features",
  "collaborations",
  "writing-credits",
]);

function parseApiError(message: string): string {
  try {
    const data = JSON.parse(message) as { detail?: string };
    if (data.detail) return data.detail;
  } catch {
    /* ignore */
  }
  return message;
}

function normalizePlaybackArt(art: ReleasePlaybackArt): ReleasePlaybackArt {
  return {
    cover_url: art.cover_url ?? null,
    cover_animation_url: art.cover_animation_url ?? null,
    canvas_url: art.canvas_url ?? null,
    disc_url: art.disc_url ?? null,
    group_kind: art.group_kind ?? null,
    background_layers: art.background_layers ?? [],
  };
}

function PlaylistNeighborLink({
  neighbor,
  direction,
  onClick,
}: {
  neighbor: { id: string; title: string };
  direction: "prev" | "next";
  onClick: () => void;
}) {
  const compact = neighbor.title.length > 18;
  return (
    <button
      type="button"
      className={`release-page__neighbor release-page__neighbor--${direction}${
        compact ? " release-page__neighbor--compact" : ""
      }`}
      onClick={onClick}
      title={neighbor.title}
    >
      {direction === "prev" && (
        <span className="release-page__neighbor-arrow" aria-hidden>
          <ChevronIcon direction="left" />
        </span>
      )}
      <span className="release-page__neighbor-text">{neighbor.title}</span>
      {direction === "next" && (
        <span className="release-page__neighbor-arrow" aria-hidden>
          <ChevronIcon direction="right" />
        </span>
      )}
    </button>
  );
}

export default function SystemPlaylistPage({
  bandId,
  slug,
  userPlaylistId,
  userId,
  isAdmin = false,
  onBack,
  onPlaylistDeleted,
  onOpenPlaylist,
  onOpenRelease,
  onOpenArtist,
  onOpenShow,
  onOpenCatalogSubgenre,
  onImport,
  onSync,
  onChooseSource,
  onSwitchProfile,
  onEditProfile,
  catalogLiveShows = false,
  backLabel = "Playlists",
}: Props) {
  const isUserPlaylist = userPlaylistId != null;
  const isGlobalLiveShows = catalogLiveShows && slug === "live-shows";
  const isLiveShowsPlaylist = !isUserPlaylist && slug === "live-shows";
  const layout = useDeviceLayout();
  const mobilePortrait = isMobilePortraitLayout(layout);
  const tabletPortrait = layout === "tablet-portrait";
  const bannerLayout = mobilePortrait || tabletPortrait;
  const stacked = bannerLayout;
  const mobileLandscape = isMobileLandscapeLayout(layout);
  const tabletLayout = isTabletLayout(layout);

  const [detail, setDetail] = useState<ArtistPlaylistDetail | null>(() => {
    if (isUserPlaylist && userPlaylistId != null) {
      return getCachedUserPlaylistDetail(userPlaylistId);
    }
    if (bandId != null && slug) {
      return getCachedArtistPlaylistDetail(bandId, slug);
    }
    return null;
  });
  const [loading, setLoading] = useState(() => {
    if (isUserPlaylist && userPlaylistId != null) {
      return !getCachedUserPlaylistDetail(userPlaylistId);
    }
    if (bandId != null && slug) {
      return !getCachedArtistPlaylistDetail(bandId, slug);
    }
    return true;
  });
  const [error, setError] = useState<string | null>(null);
  const [editPlaylist, setEditPlaylist] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showReimportCsv, setShowReimportCsv] = useState(false);
  const [reimportNotice, setReimportNotice] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [nowPlayingTitle, setNowPlayingTitle] = useState<string | null>(null);
  const [playbackArt, setPlaybackArt] = useState<ReleasePlaybackArt | null>(null);
  const [panelActionTrack, setPanelActionTrack] = useState<ReleaseTrackItem | null>(null);
  const [showLyricsAction, setShowLyricsAction] = useState(true);
  const [showVersionsAction, setShowVersionsAction] = useState(true);
  const [panelDateIso, setPanelDateIso] = useState<string | null>(null);
  const [versionSource, setVersionSource] = useState<{
    album_title: string;
    navigate_release_id: string;
    navigate_band_id?: number;
    date_iso?: string | null;
    display_date?: string | null;
  } | null>(null);
  const [mobileTrackView, setMobileTrackView] =
    useState<ReleaseMobileTrackView>("tracks");
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);
  const [bgLayers, setBgLayers] = useState<{ current?: string; outgoing?: string }>({});
  const [trackWriters, setTrackWriters] = useState<string[]>([]);
  const [panelBrand, setPanelBrand] = useState<PanelBrand | null>(null);
  const [setlistTourName, setSetlistTourName] = useState<string | null>(null);
  const [setlistTrackCount, setSetlistTrackCount] = useState<number | null>(null);
  const [setlistPlaybackKey, setSetlistPlaybackKey] = useState<string | null>(null);
  const [liveShowsView, setLiveShowsView] = useState<LiveShowsViewMode>("by-show");
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverRevision, setCoverRevision] = useState(0);
  const [coverUploadBusy, setCoverUploadBusy] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);

  const tracklistRef = useRef<SystemPlaylistTracklistHandle>(null);
  const setlistRef = useRef<SetlistsPlaylistHandle>(null);
  const canvasVideoRef = useRef<HTMLVideoElement>(null);
  const sourceArtCacheRef = useRef<Map<string, ReleasePlaybackArt>>(new Map());
  const prevBgRef = useRef<string | undefined>(undefined);

  const globalMusic = useSyncExternalStore(
    subscribeGlobalMusic,
    getGlobalMusicSnapshot,
    getGlobalMusicSnapshot
  );
  const globalAudioRef = useRef<HTMLAudioElement | null>(null);
  globalAudioRef.current = getGlobalMusicAudioElement();
  const beatActive = Boolean(playingPath && globalMusic.hasTrack);
  useBeatPulse(
    globalAudioRef,
    beatActive,
    Boolean(globalMusic.playing && globalMusic.current?.path === playingPath)
  );

  const overview = bandId != null ? getCachedOverview(bandId, "landscape") : null;

  const openPersonName = useCallback(
    async (name: string) => {
      try {
        const res = await resolveArtistName(name);
        if (res.band_id && onOpenArtist) {
          onOpenArtist(res.band_id);
          return;
        }
        if (res.urls?.wikipedia) {
          window.open(res.urls.wikipedia, "_blank", "noopener,noreferrer");
          return;
        }
        if (res.urls?.musicbrainz) {
          window.open(res.urls.musicbrainz, "_blank", "noopener,noreferrer");
          return;
        }
        window.open(writerSearchUrl(name), "_blank", "noopener,noreferrer");
      } catch {
        window.open(writerSearchUrl(name), "_blank", "noopener,noreferrer");
      }
    },
    [onOpenArtist]
  );

  useEffect(() => {
    if (bandId != null) void prefetchBandOverview(bandId, "landscape");
  }, [bandId]);

  useEffect(() => {
    if (isUserPlaylist) {
      beginAlbumPageSession();
      return () => clearUserPlaylistPageTheme(userId);
    }
    if (isGlobalLiveShows) {
      beginAdaptivePageSession(userId);
      return () => clearMediaTheme(userId);
    }
    if (bandId != null && userId) {
      beginArtistPageSession(userId);
    }
    beginAlbumPageSession();
    return () => clearAlbumTheme(userId);
  }, [bandId, isGlobalLiveShows, isUserPlaylist, userId]);

  useEffect(() => {
    if (!isGlobalLiveShows || !detail?.cover_url) return;
    void colorsFromImageUrl(detail.cover_url).then((c) => {
      if (c) applyMediaTheme(c, userId);
    });
  }, [detail?.cover_url, isGlobalLiveShows, userId]);

  useEffect(() => {
    if (isUserPlaylist && userPlaylistId != null) {
      pushUserPlaylistRoute(userPlaylistId, true);
      return;
    }
    if (bandId != null && slug) {
      pushArtistRoute(
        {
          bandId,
          section: "audio",
          overviewTab: "about",
          playlistSlug: slug,
        },
        true
      );
    }
  }, [bandId, isUserPlaylist, slug, userPlaylistId]);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    const isTimeoutError = (message: string) =>
      /timed out/i.test(message) || /timeout/i.test(message);

    const loadUser = async () => {
      if (userPlaylistId == null) return;
      const cached = getCachedUserPlaylistDetail(userPlaylistId);
      if (cached) {
        setDetail(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const d = await prefetchUserPlaylistDetail(userPlaylistId, {
            force: true,
          });
          if (!cancelled) setDetail(d);
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          const msg = e instanceof Error ? e.message : String(e);
          if (attempt === 0 && isTimeoutError(msg) && !cancelled) {
            continue;
          }
          break;
        }
      }
      if (!cancelled) {
        if (lastError) {
          setError(
            parseApiError(
              lastError instanceof Error ? lastError.message : String(lastError)
            )
          );
        }
        setLoading(false);
      }
    };

    const loadArtist = async () => {
      if (bandId == null || !slug) return;
      const cached = getCachedArtistPlaylistDetail(bandId, slug);
      if (cached) {
        setDetail(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const d = await prefetchArtistPlaylistDetail(bandId, slug, {
            force: true,
          });
          if (!cancelled) setDetail(d);
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          const msg = e instanceof Error ? e.message : String(e);
          if (attempt === 0 && isTimeoutError(msg) && !cancelled) {
            continue;
          }
          break;
        }
      }
      if (!cancelled) {
        if (lastError) {
          setError(
            parseApiError(
              lastError instanceof Error ? lastError.message : String(lastError)
            )
          );
        }
        setLoading(false);
      }
    };

    if (isUserPlaylist && userPlaylistId != null) {
      void loadUser();
      const onPlaylistsChanged = () => {
        void prefetchUserPlaylistDetail(userPlaylistId, { force: true })
          .then((d) => {
            if (!cancelled) setDetail(d);
          })
          .catch(() => {});
      };
      window.addEventListener("playlists-changed", onPlaylistsChanged);
      return () => {
        cancelled = true;
        window.removeEventListener("playlists-changed", onPlaylistsChanged);
      };
    }
    const loadGlobalLiveShows = async () => {
      setLoading(true);
      try {
        const d = await fetchGlobalLiveShowsDetail();
        if (!cancelled) setDetail(d);
      } catch (e) {
        if (!cancelled) {
          setError(parseApiError(e instanceof Error ? e.message : String(e)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (isGlobalLiveShows) {
      void loadGlobalLiveShows();
      return () => {
        cancelled = true;
      };
    }
    if (bandId == null || !slug) return;
    void loadArtist();
    return () => {
      cancelled = true;
    };
  }, [bandId, isGlobalLiveShows, isUserPlaylist, slug, userPlaylistId]);

  useEffect(() => {
    // Reset playlist panel UI only — keep global playback running across navigation.
    setPlayingPath(null);
    setNowPlayingTitle(null);
    setPlaybackArt(null);
    setPanelActionTrack(null);
    setShowLyricsAction(true);
    setShowVersionsAction(true);
    setVersionSource(null);
    setPanelDateIso(null);
    setTrackWriters([]);
    setPanelBrand(null);
    setMobileTrackView("tracks");
    setMoreInfoOpen(false);
    sourceArtCacheRef.current.clear();
    prevBgRef.current = undefined;
  }, [slug, userPlaylistId]);

  const allTracks = detail?.tracks ?? [];
  const isSnapshotPlaylist = detail?.snapshot_filters === true;
  const isListeningWrapped =
    isUserPlaylist &&
    (detail?.listening_wrapped_year != null ||
      /^\d{4}\s+Wrapped$/i.test((detail?.name || "").trim()));
  const wrappedModules = useMemo(() => {
    if (!isListeningWrapped) return [] as string[];
    const order = ["music", "series", "movies", "books", "games"];
    const present = new Set<string>();
    for (const m of detail?.wrapped_modules || []) {
      const key = String(m || "")
        .trim()
        .toLowerCase();
      if (key) present.add(key);
    }
    for (const t of allTracks) {
      present.add(String(t.module || "music").trim().toLowerCase() || "music");
    }
    const mods = order.filter((m) => present.has(m));
    return mods.length > 0 ? mods : ["music"];
  }, [isListeningWrapped, detail?.wrapped_modules, allTracks]);
  const wrappedEntryModule = useMemo(() => {
    if (!isListeningWrapped || userPlaylistId == null) return null;
    const entry = getWrappedPlaylistEntry();
    if (!entry || entry.playlistId !== userPlaylistId) return null;
    return entry.module;
  }, [isListeningWrapped, userPlaylistId]);
  const [wrappedModule, setWrappedModule] = useState(
    () => wrappedEntryModule || "music"
  );
  const [wrappedModuleOpen, setWrappedModuleOpen] = useState(false);
  const wrappedModuleRef = useRef<HTMLDivElement>(null);
  const wrappedEntryAppliedRef = useRef(false);

  useEffect(() => {
    if (!wrappedModules.length) return;
    if (
      wrappedEntryModule &&
      wrappedModules.includes(wrappedEntryModule) &&
      !wrappedEntryAppliedRef.current
    ) {
      wrappedEntryAppliedRef.current = true;
      setWrappedModule(wrappedEntryModule);
      return;
    }
    if (!wrappedModules.includes(wrappedModule)) {
      setWrappedModule(wrappedModules[0]);
    }
  }, [wrappedModules, wrappedModule, wrappedEntryModule]);

  useEffect(() => {
    if (!wrappedModuleOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrappedModuleRef.current?.contains(e.target as Node)) {
        setWrappedModuleOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [wrappedModuleOpen]);

  const tracks = useMemo(() => {
    if (!isListeningWrapped) return allTracks;
    return allTracks.filter(
      (t) => (t.module || "music").toLowerCase() === wrappedModule
    );
  }, [allTracks, isListeningWrapped, wrappedModule]);
  const canReimportCsv =
    isUserPlaylist &&
    isSnapshotPlaylist &&
    detail?.editable !== false &&
    (detail?.source === "file" || detail?.source === "csv");

  useEffect(() => {
    if (!reimportNotice) return;
    const t = window.setTimeout(() => setReimportNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [reimportNotice]);
  const [snapshotFilterState, setSnapshotFilterState] = useState<SnapshotFilterState>({
    artists: [],
    genres: [],
  });
  const [trackSort, setTrackSort] = useState<{ key: PlaylistTrackSortKey; desc: boolean }>(() =>
    slug === "music-videos" ? { key: "year", desc: false } : { key: "original", desc: false }
  );

  useEffect(() => {
    if (!isListeningWrapped) return;
    setTrackSort({ key: "plays", desc: true });
  }, [isListeningWrapped, userPlaylistId]);
  const [subgenreNames, setSubgenreNames] = useState<string[]>([]);
  const [subgenreIdByName, setSubgenreIdByName] = useState<Map<string, number>>(new Map());

  const originalTrackNumbers = useMemo(() => {
    const map = new Map<number, number>();
    tracks.forEach((t, i) => {
      if (t.entry_id != null) map.set(t.entry_id, i + 1);
    });
    return map;
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    if (!isSnapshotPlaylist) return tracks;
    return applySnapshotFilters(tracks, snapshotFilterState);
  }, [isSnapshotPlaylist, snapshotFilterState, tracks]);

  const liveShowsTracks = useMemo(() => {
    if (!isLiveShowsPlaylist) return tracks;
    if (liveShowsView === "by-show") return tracks;
    return buildUniqueLiveTracks(tracks);
  }, [isLiveShowsPlaylist, liveShowsView, tracks]);

  const liveShowsSections = useMemo(() => {
    if (!isLiveShowsPlaylist || !detail) return detail?.sections;
    if (liveShowsView === "by-show") return detail.sections;
    if (liveShowsView === "by-artist") {
      return buildLiveShowsArtistSections(tracks);
    }
    return undefined;
  }, [detail, isLiveShowsPlaylist, liveShowsView, tracks]);

  const displayLiveShowsSections = useMemo(() => {
    if (!liveShowsSections) return undefined;
    if (liveShowsView === "all-tracks" || trackSort.key === "original") {
      return liveShowsSections;
    }
    return liveShowsSections.map((section) => ({
      ...section,
      tracks: applyTrackSort(
        section.tracks,
        trackSort.key,
        trackSort.desc,
        originalTrackNumbers
      ),
    }));
  }, [
    liveShowsSections,
    liveShowsView,
    originalTrackNumbers,
    trackSort.desc,
    trackSort.key,
  ]);

  const displayTracks = useMemo(() => {
    if (slug === "live-shows") {
      return applyTrackSort(
        liveShowsTracks,
        trackSort.key,
        trackSort.desc,
        originalTrackNumbers
      );
    }
    if (slug === "live-story") return tracks;
    const base =
      slug === "music-videos" ? dedupeMusicVideoTracks(filteredTracks) : filteredTracks;
    const sorted = applyTrackSort(base, trackSort.key, trackSort.desc, originalTrackNumbers);
    return isSnapshotPlaylist ? dedupeTracksByPlayPath(sorted) : sorted;
  }, [
    filteredTracks,
    isSnapshotPlaylist,
    liveShowsTracks,
    originalTrackNumbers,
    slug,
    trackSort.desc,
    trackSort.key,
    tracks,
  ]);

  const handleSnapshotFilterStateChange = useCallback((state: SnapshotFilterState) => {
    setSnapshotFilterState(state);
  }, []);

  const handleTrackSortChange = useCallback((key: PlaylistTrackSortKey, desc: boolean) => {
    setTrackSort({ key, desc });
  }, []);

  const handleFilterReset = useCallback(() => {
    setTrackSort({ key: "original", desc: false });
  }, []);

  const openSnapshotGenre = useCallback(
    (genre: string) => {
      if (!onOpenCatalogSubgenre) return;
      const id = subgenreIdByName.get(genre.toLowerCase());
      if (id != null) onOpenCatalogSubgenre(id, genre);
    },
    [onOpenCatalogSubgenre, subgenreIdByName]
  );

  useEffect(() => {
    setTrackSort({ key: "original", desc: false });
    setSnapshotFilterState({ artists: [], genres: [] });
    setLiveShowsView("by-show");
  }, [slug, userPlaylistId, catalogLiveShows]);

  useEffect(() => {
    if (!isLiveShowsPlaylist) return;
    if (!isGlobalLiveShows && liveShowsView === "by-artist") {
      setLiveShowsView("by-show");
    }
  }, [isGlobalLiveShows, isLiveShowsPlaylist, liveShowsView]);

  useEffect(() => {
    if (!isSnapshotPlaylist) return;
    void fetchPlaylistSubgenres()
      .then((res) => setSubgenreNames(res.items ?? []))
      .catch(() => setSubgenreNames([]));
    void fetchFilterOptions()
      .then((opts) => {
        const map = new Map<string, number>();
        for (const group of opts.subgenre_groups) {
          for (const item of group.items) {
            if (item.name) map.set(item.name.toLowerCase(), item.id);
          }
        }
        setSubgenreIdByName(map);
      })
      .catch(() => setSubgenreIdByName(new Map()));
  }, [isSnapshotPlaylist]);

  const activePlaylistTrack = useMemo(() => {
    if (!playingPath) return null;
    return tracks.find((t) => t.play_path === playingPath) ?? null;
  }, [playingPath, tracks]);
  const activeSnapshot = activePlaylistTrack?.snapshot ?? null;
  const bustCoverUrl = useCallback(
    (url: string | undefined | null) => {
      if (!url) return "";
      if (/\/playlists\/\d+\/cover/.test(url)) {
        const base = url.split("?")[0]!;
        return `${base}?v=${coverRevision}`;
      }
      return url;
    },
    [coverRevision]
  );
  const coverUrl =
    systemPlaylistCoverUrl(
      !isUserPlaylist ? slug : null,
      bustCoverUrl(detail?.cover_url) ||
        (isUserPlaylist ? DEFAULT_USER_PLAYLIST_COVER : undefined) ||
        coverUrlFallback(tracks) ||
        null
    ) || "";
  const canEditPlaylistCover =
    isUserPlaylist &&
    detail?.editable !== false &&
    editPlaylist &&
    !isListeningWrapped &&
    !coverUploadBusy;
  const hasCustomCover = Boolean(detail?.has_custom_cover);
  const showCoverPlaceholder = canEditPlaylistCover && !hasCustomCover;

  const openCoverPicker = useCallback(() => {
    if (coverUploadBusy) return;
    if (isListeningWrapped) {
      if (!isUserPlaylist || detail?.editable === false) return;
      coverInputRef.current?.click();
      return;
    }
    if (!canEditPlaylistCover) return;
    coverInputRef.current?.click();
  }, [
    canEditPlaylistCover,
    coverUploadBusy,
    detail?.editable,
    isListeningWrapped,
    isUserPlaylist,
  ]);

  const onCoverFileChange = useCallback(
    async (file: File | null) => {
      if (!file || userPlaylistId == null) return;
      setCoverUploadBusy(true);
      setError(null);
      try {
        const res = await uploadUserPlaylistCover(userPlaylistId, file);
        setCoverRevision((v) => v + 1);
        clearUserPlaylistDetailCache(userPlaylistId);
        const updated = await prefetchUserPlaylistDetail(userPlaylistId, { force: true });
        setDetail({ ...updated, cover_url: res.cover_url });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setCoverUploadBusy(false);
        if (coverInputRef.current) coverInputRef.current.value = "";
      }
    },
    [userPlaylistId]
  );
  useEffect(() => {
    setCoverFailed(false);
  }, [coverUrl, playingPath, editPlaylist, userPlaylistId, slug]);

  const isPlaying = Boolean(
    playingPath &&
      globalMusic.playing &&
      globalMusic.current?.path === playingPath
  );
  // Panel art/meta while this playlist's track is current (playing or paused).
  const hasActiveTrack = Boolean(
    playingPath &&
      globalMusic.hasTrack &&
      globalMusic.current?.path === playingPath
  );
  const showTrackPanel = Boolean(hasActiveTrack && nowPlayingTitle);
  // Idle / playlist-head mode: always show the playlist cover beside the disc.
  const usePlaylistCoverArt = isUserPlaylist && !showTrackPanel;

  const activeTrackCover = playingPath
    ? tracks.find((track) => track.play_path === playingPath)?.cover_url ?? null
    : null;
  const displayCover = usePlaylistCoverArt
    ? coverUrl
    : hasActiveTrack
      ? (playbackArt?.cover_url ?? activeTrackCover ?? coverUrl)
      : coverUrl;
  const displayAnim = isPlaying && !usePlaylistCoverArt
    ? (playbackArt?.cover_animation_url ?? null)
    : null;
  const displayCanvas = isPlaying && !usePlaylistCoverArt
    ? (playbackArt?.canvas_url ?? null)
    : null;
  const displayDisc = usePlaylistCoverArt
    ? DEFAULT_DISC_URL
    : hasActiveTrack
      ? (playbackArt?.disc_url ?? activePlaylistTrack?.disc_url ?? DEFAULT_DISC_URL)
      : DEFAULT_DISC_URL;
  const showPanelCanvas = Boolean(displayCanvas) && isVideoMedia(displayCanvas);
  const panelCoverSrc = (() => {
    // Idle playlist without a real uploaded cover → disc only (centered).
    if (usePlaylistCoverArt && isUserPlaylist && !hasCustomCover) return "";
    if (usePlaylistCoverArt) return coverUrl;
    if (hasActiveTrack) {
      return displayAnim && isVideoMedia(displayAnim) ? displayAnim : displayCover;
    }
    return coverUrl;
  })();
  const showPanelCover = Boolean(
    showCoverPlaceholder || (panelCoverSrc && !coverFailed)
  );
  /** Music Videos playlist: cover only (no disc peeking out), all breakpoints. */
  const hidePlaylistDisc = !isUserPlaylist && slug === "music-videos";
  const panelDiscSrc = hidePlaylistDisc ? "" : displayDisc;
  const panelGroupKind = usePlaylistCoverArt ? "disc" : (playbackArt?.group_kind ?? "disc");
  const isVinylPlayback = panelGroupKind === "side" || panelGroupKind === "vinyl";

  const bgUrl = usePlaylistCoverArt
    ? coverUrl
    : hasActiveTrack
      ? (playbackArt?.background_layers?.[0] ??
        playbackArt?.cover_url ??
        displayCover ??
        coverUrl)
      : coverUrl;

  useEffect(() => {
    if (!bgUrl) return;
    const outgoing = prevBgRef.current;
    prevBgRef.current = bgUrl;
    if (outgoing === bgUrl) {
      setBgLayers({ current: bgUrl });
      return;
    }
    setBgLayers({ current: bgUrl, outgoing });
    const t = window.setTimeout(() => {
      setBgLayers((s) => ({ current: s.current, outgoing: undefined }));
    }, 360);
    return () => window.clearTimeout(t);
  }, [bgUrl]);

  const themeSampleUrl = displayCover ?? coverUrl;

  useEffect(() => {
    if (!themeSampleUrl) return;
    void colorsFromImageUrl(themeSampleUrl).then((colors) => {
      if (colors) applyAlbumTheme(colors);
    });
  }, [themeSampleUrl]);

  useEffect(() => {
    if (!displayCanvas || !showPanelCanvas) return;
    const el = canvasVideoRef.current;
    if (!el) return;
    if (isPlaying) void el.play().catch(() => {});
    else el.pause();
  }, [displayCanvas, showPanelCanvas, isPlaying]);

  const resolvePlaybackArt = useCallback(
    async (
      path: string,
      releaseId?: string | null,
      navBandId?: number | null
    ): Promise<ReleasePlaybackArt | null> => {
      const cached = sourceArtCacheRef.current.get(path);
      if (cached) return cached;
      const bid = navBandId ?? bandId;
      if (!bid || !releaseId) return null;
      try {
        const res = await fetchTrackSourceArt(bid, releaseId, path);
        const art = normalizePlaybackArt(res.playback);
        sourceArtCacheRef.current.set(path, art);
        return art;
      } catch {
        return null;
      }
    },
    [bandId]
  );

  const artArgsForTrack = useCallback((track: ArtistPlaylistTrack | null | undefined) => {
    if (!track) {
      return { path: null as string | null, releaseId: null as string | null };
    }
    return {
      path: track.art_play_path || track.play_path || null,
      releaseId: track.art_navigate_release_id || track.navigate_release_id || null,
    };
  }, []);

  const trackFallbackArt = useCallback((source?: ArtistPlaylistTrack | null) => {
    return normalizePlaybackArt({
      cover_url: source?.cover_url ?? null,
      disc_url: source?.disc_url ?? null,
      cover_animation_url: source?.cover_animation_url ?? null,
      canvas_url: source?.canvas_url ?? null,
      background_layers:
        source?.background_layers?.length
          ? source.background_layers
          : source?.cover_url
            ? [source.cover_url]
            : [],
    });
  }, []);

  const handlePlayTrack = useCallback(
    (
      path: string,
      title: string,
      art?: ReleasePlaybackArt,
      source?: ArtistPlaylistTrack,
      playbackKey?: string
    ) => {
      const sameSetlistPlayback =
        !isUserPlaylist &&
        slug === "setlists" &&
        playbackKey != null &&
        setlistPlaybackKey === playbackKey;
      if (
        playingPath === path &&
        globalMusic.hasTrack &&
        globalMusic.current?.path === path &&
        (isUserPlaylist || slug !== "setlists" || sameSetlistPlayback)
      ) {
        globalMusicToggle();
        return;
      }
      if (playbackKey) setSetlistPlaybackKey(playbackKey);
      setPlayingPath(path);
      setNowPlayingTitle(title);
      setVersionSource(null);
      if (stacked) setMobileTrackView("player");
      const fallbackArt = art
        ? normalizePlaybackArt(art)
        : trackFallbackArt(source);
      setPlaybackArt(fallbackArt);
      if (source?.cover_url || source?.art_play_path) {
        sourceArtCacheRef.current.set(path, fallbackArt);
      }

      const queueSource = tracks.filter((t) => Boolean(t.play_path));
      const globalTracks: GlobalMusicTrack[] = queueSource.map((t) => ({
        id: t.play_path!,
        path: t.play_path!,
        title: t.title || "Track",
        artist: t.artist_name ?? overview?.name ?? null,
        artistId: t.navigate_band_id ?? bandId ?? null,
        releaseId: t.navigate_release_id ?? null,
        releaseTitle: t.album_title ?? null,
        coverUrl: t.cover_url ?? null,
      }));
      const start = globalTracks.findIndex((t) => t.path === path);
      if (start < 0) {
        globalMusicPlayFrom(
          [
            {
              id: path,
              path,
              title,
              artist: source?.artist_name ?? overview?.name ?? null,
              artistId: source?.navigate_band_id ?? bandId ?? null,
              releaseId: source?.navigate_release_id ?? null,
              releaseTitle: source?.album_title ?? null,
              coverUrl: fallbackArt.cover_url ?? source?.cover_url ?? null,
            },
          ],
          0
        );
      } else {
        globalMusicPlayFrom(globalTracks, start);
      }

      const restart =
        !isUserPlaylist &&
        slug === "setlists" &&
        playingPath === path &&
        !sameSetlistPlayback;
      if (restart) {
        globalMusicSeekRatio(0);
      }

      const artArgs = artArgsForTrack(source);
      void resolvePlaybackArt(
        artArgs.path || path,
        artArgs.releaseId ??
          source?.navigate_release_id ??
          panelActionTrack?.navigate_release_id,
        source?.navigate_band_id ?? bandId
      ).then((resolved) => {
        if (resolved) {
          setPlaybackArt(resolved);
          sourceArtCacheRef.current.set(path, resolved);
        }
      });
      void prefetchTrackCredits(
        source?.navigate_band_id ?? bandId ?? 0,
        source?.navigate_release_id ?? "",
        title
      ).then((res) => {
        if (res?.writers?.length) setTrackWriters(res.writers);
      });
    },
    [
      artArgsForTrack,
      bandId,
      globalMusic.current?.path,
      globalMusic.hasTrack,
      isUserPlaylist,
      overview?.name,
      panelActionTrack?.navigate_release_id,
      playingPath,
      resolvePlaybackArt,
      setlistPlaybackKey,
      slug,
      stacked,
      trackFallbackArt,
      tracks,
    ]
  );

  // When global queue advances, keep playlist panel art/title in sync.
  useEffect(() => {
    const cur = globalMusic.current;
    if (!cur?.path) return;
    const inList = tracks.some((t) => t.play_path === cur.path);
    if (!inList) return;
    if (playingPath === cur.path && nowPlayingTitle === cur.title) return;
    setPlayingPath(cur.path);
    setNowPlayingTitle(cur.title);
    const source = tracks.find((t) => t.play_path === cur.path);
    if (source) {
      const cached = sourceArtCacheRef.current.get(cur.path);
      if (cached) setPlaybackArt(cached);
      else setPlaybackArt(trackFallbackArt(source));
    }
  }, [
    globalMusic.current,
    nowPlayingTitle,
    playingPath,
    trackFallbackArt,
    tracks,
  ]);

  useEffect(() => {
    if (!playingPath) return;
    const source = tracks.find((t) => t.play_path === playingPath);
    const artArgs = artArgsForTrack(source);
    void resolvePlaybackArt(
      artArgs.path || playingPath,
      artArgs.releaseId ?? source?.navigate_release_id,
      source?.navigate_band_id ?? bandId
    ).then((resolved) => {
      if (resolved) setPlaybackArt(resolved);
    });
  }, [artArgsForTrack, bandId, playingPath, resolvePlaybackArt, tracks]);

  const playingTrack = useMemo(() => {
    if (
      playingPath &&
      !isUserPlaylist &&
      slug === "setlists" &&
      panelActionTrack?.play_path === playingPath
    ) {
      return panelActionTrack;
    }
    return playingPath ? (tracks.find((track) => track.play_path === playingPath) ?? null) : null;
  }, [isUserPlaylist, panelActionTrack, playingPath, slug, tracks]);
  const creditsBandId = playingTrack?.navigate_band_id ?? bandId ?? 0;

  const artistName = isUserPlaylist
    ? ((playingTrack as ArtistPlaylistTrack | null)?.artist_name ??
      panelBrand?.name ??
      detail?.name ??
      "Playlist")
    : (overview?.name ?? panelBrand?.name ?? "Artist");

  const showArtistInMeta = isUserPlaylist || Boolean(slug && MULTI_ARTIST_PLAYLIST_SLUGS.has(slug));
  const refreshUserPlaylist = useCallback(() => {
    if (!isUserPlaylist || userPlaylistId == null) return;
    prefetchUserPlaylistDetail(userPlaylistId, { force: true })
      .then((d) => setDetail(d))
      .catch(() => {});
  }, [isUserPlaylist, userPlaylistId]);

  const wrappedReturn = useMemo(() => {
    if (!isListeningWrapped || userPlaylistId == null) return null;
    const entry = getWrappedPlaylistEntry();
    if (!entry || entry.playlistId !== userPlaylistId) return null;
    const labels: Record<string, string> = {
      music: "MUSIC",
      series: "SERIES",
      movies: "MOVIES",
      books: "BOOKS",
      games: "GAMES",
    };
    return {
      module: entry.module,
      label: labels[entry.module] || entry.module.toUpperCase(),
    };
  }, [isListeningWrapped, userPlaylistId]);

  const effectiveBackLabel = wrappedReturn?.label || backLabel;

  const handleBack = useCallback(() => {
    if (wrappedReturn) {
      const entry = takeWrappedPlaylistEntry();
      const mod = entry?.module || wrappedReturn.module;
      window.dispatchEvent(
        new CustomEvent("mystack:open-module-home", {
          detail: { module: mod },
        })
      );
      return;
    }
    onBack();
  }, [onBack, wrappedReturn]);

  const handleDeletePlaylist = useCallback(() => {
    if (!isUserPlaylist || userPlaylistId == null || detail?.editable === false) return;
    setDeleteError(null);
    setDeleteConfirmOpen(true);
  }, [detail?.editable, isUserPlaylist, userPlaylistId]);

  const confirmDeletePlaylist = useCallback(() => {
    if (!isUserPlaylist || userPlaylistId == null || detail?.editable === false) return;
    setDeleteBusy(true);
    setDeleteError(null);
    void deleteUserPlaylist(userPlaylistId)
      .then(() => {
        clearUserPlaylistDetailCache(userPlaylistId);
        setDeleteConfirmOpen(false);
        onPlaylistDeleted?.();
        handleBack();
      })
      .catch((err: unknown) => {
        setDeleteError(
          err instanceof Error ? err.message : "Failed to delete playlist"
        );
      })
      .finally(() => setDeleteBusy(false));
  }, [
    handleBack,
    detail?.editable,
    isUserPlaylist,
    onPlaylistDeleted,
    userPlaylistId,
  ]);

  useEffect(() => {
    if (!detail) return;
    setEditName(detail.name);
    setEditDescription(detail.description ?? "");
  }, [detail?.name, detail?.description, detail]);

  useEffect(() => {
    if (!editPlaylist || !isUserPlaylist || userPlaylistId == null || detail?.editable === false) {
      return;
    }
    const cleanName = editName.trim();
    if (!cleanName) return;
    const t = window.setTimeout(() => {
      void updateUserPlaylist(userPlaylistId, {
        name: cleanName,
        description: editDescription.trim() || null,
      })
        .then(() => refreshUserPlaylist())
        .catch(() => {});
    }, 600);
    return () => window.clearTimeout(t);
  }, [
    editDescription,
    editName,
    editPlaylist,
    isUserPlaylist,
    detail?.editable,
    refreshUserPlaylist,
    userPlaylistId,
  ]);

  useEffect(() => {
    if (!isUserPlaylist) setEditPlaylist(false);
  }, [isUserPlaylist, userPlaylistId]);

  useEffect(() => {
    if (!nowPlayingTitle || !panelActionTrack?.navigate_release_id) {
      setTrackWriters([]);
      return;
    }
    const releaseId = panelActionTrack.navigate_release_id;
    const cached = getCachedTrackCredits(creditsBandId, releaseId, nowPlayingTitle);
    if (cached) {
      setTrackWriters(cached.writers ?? []);
      return;
    }
    let cancelled = false;
    void prefetchTrackCredits(creditsBandId, releaseId, nowPlayingTitle).then((res) => {
      if (!cancelled) setTrackWriters(res.writers ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [bandId, creditsBandId, nowPlayingTitle, panelActionTrack?.navigate_release_id]);

  const hidePerformerName =
    !isUserPlaylist && (slug === "appearances" || slug === "features") ? artistName : undefined;
  const hideCoverArtist = !isUserPlaylist && slug === "tributes" ? artistName : undefined;
  const trackPanelMeta = nowPlayingTitle
    ? parseTrackPanelMeta(nowPlayingTitle, {
        hidePerformer: hidePerformerName,
        hideCoverArtist,
      })
    : null;
  const panelWriters = useMemo(() => {
    if (trackWriters.length > 0) return trackWriters;
    if (!isUserPlaylist && slug === "writing-credits" && nowPlayingTitle) return [artistName];
    return [];
  }, [artistName, isUserPlaylist, nowPlayingTitle, slug, trackWriters]);
  const brandDateIso =
    panelDateIso ?? versionSource?.date_iso ?? playingTrack?.release_date ?? null;
  const trackPerformerName = useMemo(() => {
    const line = trackPanelMeta?.lines.find((entry) => entry.kind === "performer");
    if (!line || line.kind !== "performer") return null;
    return primaryArtistName(line.artist);
  }, [trackPanelMeta]);

  useEffect(() => {
    let cancelled = false;

    async function loadPanelBrand() {
      if (isUserPlaylist && !showTrackPanel) {
        setPanelBrand(null);
        return;
      }

      const applyOverview = (
        targetBandId: number,
        name: string,
        overviewData: BandOverview | null,
        inLibrary: boolean
      ) => {
        const branding = eraBrandingFromOverview(overviewData, brandDateIso);
        setPanelBrand({
          bandId: targetBandId,
          name: overviewData?.name ?? name,
          iconUrl: branding.iconUrl,
          logoUrl: branding.logoUrl,
          inLibrary,
        });
      };

      // Wrapped / user playlists: resolve the playing track's artist (logo/icon),
      // never fall back to the playlist title (e.g. "2026 Wrapped").
      if (isUserPlaylist && showTrackPanel) {
        const track = playingTrack as ArtistPlaylistTrack | null;
        const bandFromTrack =
          typeof track?.navigate_band_id === "number"
            ? track.navigate_band_id
            : null;
        const nameFromTrack = (
          track?.artist_name ||
          trackPerformerName ||
          ""
        ).trim();
        if (bandFromTrack) {
          try {
            const ov = await prefetchBandOverview(bandFromTrack, "landscape");
            if (cancelled) return;
            applyOverview(
              bandFromTrack,
              ov?.name || nameFromTrack || "Artist",
              ov,
              true
            );
            return;
          } catch {
            /* try name resolve next */
          }
        }
        if (nameFromTrack) {
          try {
            const resolved = await resolveArtistName(nameFromTrack);
            if (cancelled) return;
            if (resolved.band_id) {
              const ov = await prefetchBandOverview(
                resolved.band_id,
                "landscape"
              );
              if (cancelled) return;
              applyOverview(
                resolved.band_id,
                resolved.name || nameFromTrack,
                ov,
                true
              );
              return;
            }
            setPanelBrand({
              bandId: 0,
              name: nameFromTrack,
              iconUrl: null,
              logoUrl: null,
              inLibrary: false,
            });
            return;
          } catch {
            if (!cancelled) {
              setPanelBrand({
                bandId: 0,
                name: nameFromTrack,
                iconUrl: null,
                logoUrl: null,
                inLibrary: false,
              });
            }
            return;
          }
        }
        if (!cancelled) setPanelBrand(null);
        return;
      }

      if (showTrackPanel && trackPerformerName) {
        const performerName = trackPerformerName;
        try {
          const resolved = await resolveArtistName(performerName);
          if (cancelled) return;
          if (resolved.band_id) {
            const performerOverview = await prefetchBandOverview(resolved.band_id, "landscape");
            if (cancelled) return;
            applyOverview(
              resolved.band_id,
              resolved.name || performerName,
              performerOverview,
              true
            );
            return;
          }
          setPanelBrand({
            bandId: bandId ?? 0,
            name: performerName,
            iconUrl: null,
            logoUrl: null,
            inLibrary: false,
          });
        } catch {
          if (!cancelled) {
            setPanelBrand({
              bandId: bandId ?? 0,
              name: performerName,
              iconUrl: null,
              logoUrl: null,
              inLibrary: false,
            });
          }
        }
        return;
      }

      if (isUserPlaylist || bandId == null) {
        setPanelBrand(null);
        return;
      }

      try {
        const pageOverview = await prefetchBandOverview(bandId, "landscape");
        if (cancelled) return;
        applyOverview(bandId, pageOverview.name, pageOverview, true);
      } catch {
        if (!cancelled) {
          const cached = getCachedOverview(bandId, "landscape");
          const branding = eraBrandingFromOverview(cached, brandDateIso);
          setPanelBrand({
            bandId,
            name: cached?.name ?? artistName,
            iconUrl: branding.iconUrl,
            logoUrl: branding.logoUrl,
            inLibrary: true,
          });
        }
      }
    }

    void loadPanelBrand();
    return () => {
      cancelled = true;
    };
  }, [
    artistName,
    bandId,
    brandDateIso,
    isUserPlaylist,
    playingTrack,
    showTrackPanel,
    trackPerformerName,
  ]);

  const panelBrandName =
    panelBrand?.name ??
    (showTrackPanel
      ? trackPerformerName ||
        (isUserPlaylist
          ? (playingTrack as ArtistPlaylistTrack | null)?.artist_name || null
          : null) ||
        (!isUserPlaylist ? artistName : null) ||
        "Artist"
      : isUserPlaylist
        ? (detail?.name ?? "Playlist")
        : artistName);
  const panelBrandIconUrl = panelBrand?.iconUrl ?? null;
  const panelBrandLogoUrl = panelBrand?.logoUrl ?? null;

  const openPanelBrand = useCallback(() => {
    if (!panelBrand) return;
    if (panelBrand.inLibrary && onOpenArtist) {
      onOpenArtist(panelBrand.bandId);
      return;
    }
    void openPersonName(panelBrandName);
  }, [onOpenArtist, openPersonName, panelBrand, panelBrandName]);

  const trackPanelReleaseDate =
    versionSource?.display_date ??
    (versionSource?.date_iso ? formatTrackDate(versionSource.date_iso) : null) ??
    (!isUserPlaylist && slug !== "setlists" && panelDateIso ? formatTrackDate(panelDateIso) : null) ??
    (isSnapshotPlaylist && activeSnapshot?.release_date
      ? formatTrackDate(activeSnapshot.release_date)
      : null) ??
    ((playingTrack as ArtistPlaylistTrack | null)?.release_date
      ? formatTrackDate((playingTrack as ArtistPlaylistTrack).release_date!)
      : null) ??
    null;

  // Open info when the active track changes so track meta is visible; user can still collapse.
  useEffect(() => {
    if (bannerLayout && playingPath) {
      setMoreInfoOpen(true);
    }
  }, [playingPath, bannerLayout]);

  const pageCanvasActive = bannerLayout && showPanelCanvas;
  const overviewLandscape =
    overview?.eras?.find((e) => e.landscape_url)?.landscape_url ?? null;
  const bannerBgUrl =
    coverUrl ||
    activeTrackCover ||
    playbackArt?.cover_url ||
    overviewLandscape ||
    "";

  const pageClass = [
    "release-page",
    stacked ? "release-page--stacked" : "",
    bannerLayout ? "release-page--banner-layout" : "",
    mobileLandscape ? "release-page--mobile-landscape" : "",
    tabletLayout ? "release-page--tablet" : "",
    tabletPortrait ? "release-page--tablet-portrait" : "",
    stacked && !bannerLayout && mobileTrackView === "player"
      ? "release-page--track-player"
      : "",
    stacked && !bannerLayout && mobileTrackView === "tracks"
      ? "release-page--track-tracks"
      : "",
    beatActive ? "release-page--beat-ready" : "",
    isPlaying ? "release-page--playing" : "",
    hasActiveTrack && isVinylPlayback ? "release-page--vinyl" : "",
    pageCanvasActive ? "release-page--canvas" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handlePanelActionsChange = useCallback(
    ({
      track,
      showLyrics,
      showVersions,
      panelDateIso: dateIso,
      versionSource: src,
    }: {
      track: ReleaseTrackItem | null;
      showLyrics: boolean;
      showVersions: boolean;
      panelDateIso?: string | null;
      versionSource?: typeof versionSource;
    }) => {
      setPanelActionTrack(track);
      setShowLyricsAction(showLyrics);
      setShowVersionsAction(showVersions);
      setPanelDateIso(dateIso ?? null);
      setVersionSource(src ?? null);
      if (track?.title) setNowPlayingTitle(track.title);
    },
    []
  );

  const applySetlistPanelTrack = useCallback(
    (track: ReleaseTrackItem) => {
      const source = track as ArtistPlaylistTrack;
      const version = playlistTrackVersionSource(source, bandId);
      handlePanelActionsChange({
        track,
        showLyrics: Boolean(source.navigate_release_id),
        showVersions: Boolean(source.navigate_release_id),
        panelDateIso: source.release_date ?? null,
        versionSource: version,
      });
    },
    [bandId, handlePanelActionsChange]
  );

  if (loading && !detail) {
    return <PlaylistBoot label="Loading playlist…" />;
  }

  if (error && !detail) {
    return (
      <PlaylistBoot
        error={error}
        onBack={onBack}
        backLabel="← Playlists"
      />
    );
  }

  if (!detail) {
    return (
      <div className="release-page">
        <p className="muted artist-section-empty">Playlist not found.</p>
        <button type="button" className="btn" onClick={onBack}>
          ← Playlists
        </button>
      </div>
    );
  }

  const panelFadedCover = displayCover ?? coverUrl;

  return (
    <div className={pageClass}>
      <div className="release-page__bg-stack" aria-hidden>
        {bgLayers.outgoing && (
          <div
            className="release-page__bg release-page__bg--visible release-page__bg--out"
            style={{ backgroundImage: `url("${bgLayers.outgoing}")` }}
          />
        )}
        {bgLayers.current && (
          <div
            className={`release-page__bg release-page__bg--visible${
              bgLayers.outgoing ? " release-page__bg--in" : ""
            }`}
            style={{ backgroundImage: `url("${bgLayers.current}")` }}
          />
        )}
        {pageCanvasActive && displayCanvas ? (
          <div className="release-page__bg-canvas" aria-hidden>
            <video
              key={displayCanvas}
              ref={canvasVideoRef}
              className="release-page__bg-canvas-video"
              src={displayCanvas}
              autoPlay
              loop
              muted
              playsInline
            />
            <div className="release-page__bg-canvas-shade" />
          </div>
        ) : null}
        <MediaBeatFx />
      </div>

      <div className="release-page__chrome">
        <header className="release-page__top">
          <div className="release-page__top-left">
            <button
              type="button"
              className="release-page__back"
              onClick={handleBack}
              aria-label={`Back to ${effectiveBackLabel}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M15 6l-6 6 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{effectiveBackLabel}</span>
            </button>
          </div>
          <div className="release-page__top-center">
            <TopBarTitle
              text={detail.name.toLocaleUpperCase()}
              className="release-page__title-center"
            />
          </div>
          <div className="release-page__top-right">
            {isLiveShowsPlaylist ? (
              <button
                type="button"
                className="catalog-scope-toggle catalog-scope-toggle--switch live-shows-scope-toggle"
                aria-label={`Live shows view: ${liveShowsView}. Click to change.`}
                onClick={() =>
                  setLiveShowsView((v) =>
                    nextLiveShowsViewMode(v, { allowByArtist: isGlobalLiveShows })
                  )
                }
              >
                {liveShowsView === "by-show" ? (
                  <>
                    <IconByShow className="catalog-scope-toggle__icon" />
                    BY SHOW
                  </>
                ) : liveShowsView === "by-artist" ? (
                  <>
                    <IconByArtist className="catalog-scope-toggle__icon" />
                    BY ARTIST
                  </>
                ) : (
                  <>
                    <IconList className="catalog-scope-toggle__icon" />
                    ALL TRACKS
                  </>
                )}
              </button>
            ) : null}
            {!isUserPlaylist && bandId != null && (
              <MediaInlineSearch
                mode="artist-releases"
                bandId={bandId}
                onSelectRelease={(releaseId) => onOpenRelease?.(bandId, releaseId)}
                onSelectTrack={(path, title) => {
                  void handlePlayTrack(path, title);
                }}
              />
            )}
            {isListeningWrapped && wrappedModules.length > 0 ? (
              <div
                className="module-top-bar__media wrapped-playlist-module"
                ref={wrappedModuleRef}
              >
                <button
                  type="button"
                  className="module-top-bar__media-btn"
                  onClick={() => setWrappedModuleOpen((o) => !o)}
                  aria-expanded={wrappedModuleOpen}
                  aria-label={`Wrapped module: ${
                    WRAPPED_MODULE_META[wrappedModule]?.label || wrappedModule
                  }`}
                >
                  <span className="module-top-bar__media-icon" aria-hidden>
                    {(() => {
                      const Icon =
                        WRAPPED_MODULE_META[wrappedModule]?.Icon ||
                        IconMediaMusic;
                      return <Icon />;
                    })()}
                  </span>
                  <span className="module-top-bar__media-label">
                    <span className="module-top-bar__media-module">
                      {WRAPPED_MODULE_META[wrappedModule]?.label || "Music"}
                    </span>
                  </span>
                  <span className="module-top-bar__chevron" aria-hidden>
                    ▾
                  </span>
                </button>
                {wrappedModuleOpen ? (
                  <ul className="module-top-bar__media-menu ms-menu-pop is-open">
                    {wrappedModules.map((mod) => {
                      const meta = WRAPPED_MODULE_META[mod] || {
                        label: mod,
                        Icon: IconMediaMusic,
                      };
                      const Icon = meta.Icon;
                      return (
                        <li key={mod}>
                          <button
                            type="button"
                            className={mod === wrappedModule ? "active" : ""}
                            onClick={() => {
                              setWrappedModule(mod);
                              setWrappedModuleOpen(false);
                            }}
                          >
                            <span
                              className="module-top-bar__media-icon"
                              aria-hidden
                            >
                              <Icon />
                            </span>
                            {meta.label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <AppMenu
              onImport={onImport}
              onSync={onSync}
              onChooseSource={onChooseSource}
              isAdmin={isAdmin}
              userId={userId}
              adaptiveThemeActive
              onSwitchProfile={onSwitchProfile}
              onEditProfile={onEditProfile}
              menuVariant="release"
              showEditPlaylist={isUserPlaylist && detail?.editable !== false}
              editPlaylistActive={editPlaylist && !isListeningWrapped}
              editPlaylistLabel={isListeningWrapped ? "Edit cover" : "Edit playlist"}
              onEditPlaylistToggle={() => {
                if (isListeningWrapped) {
                  openCoverPicker();
                  return;
                }
                setEditPlaylist((v) => !v);
              }}
              showReimportCsv={canReimportCsv}
              onReimportCsv={() => setShowReimportCsv(true)}
              showDeletePlaylist={isUserPlaylist && detail?.editable !== false}
              onDeletePlaylist={handleDeletePlaylist}
            />
          </div>
        </header>

        {reimportNotice && (
          <p className="release-page__status playlist-toast" role="status">
            {reimportNotice}
          </p>
        )}

        {showReimportCsv && isUserPlaylist && userPlaylistId != null && detail && (
          <ReimportCsvModal
            playlistId={userPlaylistId}
            playlistName={detail.name}
            onClose={() => setShowReimportCsv(false)}
            onDone={(message) => {
              setShowReimportCsv(false);
              setReimportNotice(message);
              refreshUserPlaylist();
            }}
          />
        )}

        {stacked && !bannerLayout && (
          <nav className="release-page__subtabs" aria-label="Tracklist views">
            <button
              type="button"
              className={mobileTrackView === "player" ? "active" : ""}
              onClick={() => setMobileTrackView("player")}
            >
              <span>PLAYER</span>
            </button>
            <button
              type="button"
              className={mobileTrackView === "tracks" ? "active" : ""}
              onClick={() => setMobileTrackView("tracks")}
            >
              <span>TRACKS</span>
            </button>
          </nav>
        )}
      </div>

      {error && (
        <p className="release-page__status release-page__status--error" role="alert">
          {error}
        </p>
      )}

      <div className="release-page__body">
        <aside
          className={`release-page__panel${showTrackPanel ? " release-page__panel--track" : ""}${
            showPanelCanvas && !pageCanvasActive ? " release-page__panel--canvas" : ""
          }${bannerLayout ? " release-page__panel--banner" : ""}`}
          style={
            showTrackPanel && panelFadedCover
              ? ({ ["--panel-fade" as string]: `url("${panelFadedCover}")` } as CSSProperties)
              : undefined
          }
        >
          {showPanelCanvas && !pageCanvasActive && (
            <div className="release-page__panel-canvas-layer" aria-hidden>
              <video
                key={displayCanvas ?? undefined}
                ref={canvasVideoRef}
                className="release-page__panel-canvas"
                src={displayCanvas!}
                autoPlay
                loop
                muted
                playsInline
              />
              <div className="release-page__panel-canvas-shade" />
            </div>
          )}
          <div className="release-page__panel-content">
            <div className="release-page__art">
              <div
                className={`release-page__art-stage${
                  bannerLayout
                    ? " release-page__art-stage--banner"
                    : panelCoverSrc && isVideoMedia(panelCoverSrc) && isPlaying
                      ? " release-page__art-stage--video"
                      : ""
                }${
                  !bannerLayout && !showPanelCover && panelDiscSrc
                    ? " release-page__art-stage--disc-only"
                    : ""
                }${
                  hidePlaylistDisc && showPanelCover
                    ? " release-page__art-stage--cover-centered"
                    : ""
                }`}
              >
                {bannerLayout ? (
                  <span
                    className="release-page__banner-bg"
                    style={{
                      backgroundImage: bannerBgUrl ? `url("${bannerBgUrl}")` : undefined,
                    }}
                    aria-hidden
                  />
                ) : null}
                {showCoverPlaceholder ? (
                    <span
                      className={`release-page__cover-wrap release-page__cover-wrap--editable release-page__cover-wrap--placeholder${
                        bannerLayout ? " release-page__cover-wrap--banner-cover" : ""
                      }`}
                      onClick={openCoverPicker}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") openCoverPicker();
                      }}
                      role="button"
                      tabIndex={0}
                      title="Add playlist cover"
                    >
                      <span className="release-page__cover release-page__cover--placeholder">
                        <span className="release-page__cover-placeholder-text">
                          {coverUploadBusy ? "Uploading…" : "Click to add cover"}
                        </span>
                      </span>
                    </span>
                  ) : panelCoverSrc && !coverFailed ? (
                  panelCoverSrc && isVideoMedia(panelCoverSrc) && isPlaying ? (
                    <span
                      className={`release-page__cover-wrap${
                        canEditPlaylistCover ? " release-page__cover-wrap--editable release-page__cover-wrap--edit-hint" : ""
                      }${bannerLayout ? " release-page__cover-wrap--banner-cover" : ""}`}
                      onClick={canEditPlaylistCover ? openCoverPicker : undefined}
                      onKeyDown={
                        canEditPlaylistCover
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") openCoverPicker();
                            }
                          : undefined
                      }
                      role={canEditPlaylistCover ? "button" : undefined}
                      tabIndex={canEditPlaylistCover ? 0 : undefined}
                      title={canEditPlaylistCover ? "Change playlist cover" : undefined}
                    >
                      <video
                        key={panelCoverSrc}
                        src={panelCoverSrc}
                        className="release-page__cover release-page__cover--video"
                        autoPlay
                        loop
                        muted
                        playsInline
                        onError={() => setCoverFailed(true)}
                      />
                    </span>
                  ) : (
                    <span
                      className={`release-page__cover-wrap${
                        canEditPlaylistCover ? " release-page__cover-wrap--editable release-page__cover-wrap--edit-hint" : ""
                      }${bannerLayout ? " release-page__cover-wrap--banner-cover" : ""}`}
                      onClick={canEditPlaylistCover ? openCoverPicker : undefined}
                      onKeyDown={
                        canEditPlaylistCover
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") openCoverPicker();
                            }
                          : undefined
                      }
                      role={canEditPlaylistCover ? "button" : undefined}
                      tabIndex={canEditPlaylistCover ? 0 : undefined}
                      title={canEditPlaylistCover ? "Change playlist cover" : undefined}
                    >
                      <img
                        src={panelCoverSrc}
                        alt=""
                        className="release-page__cover"
                        draggable={false}
                        onError={() => setCoverFailed(true)}
                      />
                    </span>
                  )
                  ) : null}
                {panelDiscSrc ? (
                  <img
                    src={panelDiscSrc}
                    alt=""
                    className={`release-page__disc${
                      bannerLayout ? " release-page__disc--banner" : ""
                    }${
                      hasActiveTrack && isPlaying ? " release-page__disc--spin" : ""
                    }${hasActiveTrack && !isPlaying ? " release-page__disc--spin-paused" : ""}`}
                    draggable={false}
                  />
                ) : null}
              </div>
            </div>

            {bannerLayout ? (
              <button
                type="button"
                className={`release-page__more-info${moreInfoOpen ? " is-open" : ""}${
                  showTrackPanel && trackPanelMeta
                    ? " release-page__more-info--track"
                    : " release-page__more-info--release"
                }`}
                onClick={() => setMoreInfoOpen((o) => !o)}
                aria-expanded={moreInfoOpen}
              >
                {showTrackPanel && trackPanelMeta
                  ? trackPanelMeta.mainTitle
                  : detail.name}
              </button>
            ) : null}

            <MsDisclosure open={!bannerLayout || moreInfoOpen}>
            <div
              className={`release-page__panel-meta${
                bannerLayout ? " release-page__panel-meta--glass" : ""
              }`}
            >
              <div className="release-page__panel-fit">
                <div className="release-page__panel-fit-inner">
                  <div className="release-page__panel-body">
                    <div className="release-page__brand-row">
                      {panelBrandIconUrl || panelBrandLogoUrl ? (
                        <button
                          type="button"
                          className="release-page__artist-link release-page__brand-row-btn"
                          onClick={openPanelBrand}
                          aria-label={`Open ${panelBrandName}`}
                        >
                          {panelBrandIconUrl && (
                            <MediaBeatFrame variant="logo">
                              <img
                                src={panelBrandIconUrl}
                                alt=""
                                className="release-page__meta-icon"
                              />
                            </MediaBeatFrame>
                          )}
                          {panelBrandLogoUrl && (
                            <MediaBeatFrame variant="logo">
                              <img
                                src={panelBrandLogoUrl}
                                alt=""
                                className="release-page__meta-logo"
                              />
                            </MediaBeatFrame>
                          )}
                        </button>
                      ) : isUserPlaylist && !showTrackPanel ? null : (
                        <button
                          type="button"
                          className={`release-page__artist-link release-page__artist-link--text${
                            showTrackPanel &&
                            trackPerformerName &&
                            !isUserPlaylist
                              ? " release-page__artist-link--brand-name"
                              : ""
                          }`}
                          onClick={openPanelBrand}
                        >
                          {showTrackPanel &&
                          trackPerformerName &&
                          !isUserPlaylist
                            ? panelBrandName.toLocaleUpperCase()
                            : panelBrandName}
                        </button>
                      )}
                    </div>

                    {showTrackPanel && trackPanelMeta && !(editPlaylist && isSnapshotPlaylist) ? (
                      <div className="release-page__track-panel">
                        <h2 className="release-page__track-panel-title">
                          {trackPanelMeta.mainTitle}
                        </h2>
                        {trackPanelMeta.lines
                          .filter((line) => line.kind === "cover")
                          .map((line, i) =>
                            line.kind === "cover" ? (
                              <p
                                key={`cover-${i}`}
                                className="release-page__track-panel-cover"
                              >
                                <button
                                  type="button"
                                  className="release-page__person-link"
                                  onClick={() => void openPersonName(line.artist)}
                                >
                                  {line.artist}
                                </button>{" "}
                                cover
                              </p>
                            ) : null
                          )}
                        {trackPanelReleaseDate && (
                          <p className="release-page__track-panel-date">
                            Released on {trackPanelReleaseDate}
                          </p>
                        )}
                        {isSnapshotPlaylist && activeSnapshot && (
                          <>
                            {splitSnapshotGenres(activeSnapshot.genres).length > 0 ? (
                              <p className="release-page__subgenres">
                                {splitSnapshotGenres(activeSnapshot.genres).map((genre, i) => (
                                  <span key={genre}>
                                    {i > 0 && " · "}
                                    {onOpenCatalogSubgenre &&
                                    subgenreIdByName.has(genre.toLowerCase()) ? (
                                      <button
                                        type="button"
                                        className="release-page__genre-link"
                                        onClick={() => openSnapshotGenre(genre)}
                                      >
                                        {titleCaseWords(genre)}
                                      </button>
                                    ) : (
                                      <span className="release-page__genre-link">
                                        {titleCaseWords(genre)}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </p>
                            ) : null}
                          </>
                        )}
                        {!isUserPlaylist && slug === "setlists" && setlistTourName && showTrackPanel && (
                          <p className="release-page__track-panel-line">{setlistTourName}</p>
                        )}
                        {trackPanelMeta.versionLabel && (
                          <p className="release-page__track-panel-version">
                            {trackPanelMeta.versionLabel}
                          </p>
                        )}
                        {trackPanelMeta.lines
                          .filter(isAdaptationLine)
                          .map((line, i) => (
                            <p key={`adapt-${i}`} className="release-page__track-panel-line">
                              {line.text}
                            </p>
                          ))}
                        {versionSource && (
                          <p className="release-page__track-panel-source">
                            Taken from{" "}
                            {onOpenRelease ? (
                              <button
                                type="button"
                                className="release-page__release-link"
                                onClick={() =>
                                  onOpenRelease(
                                    versionSource.navigate_band_id ?? bandId ?? 0,
                                    versionSource.navigate_release_id
                                  )
                                }
                              >
                                {versionSource.album_title}
                              </button>
                            ) : (
                              versionSource.album_title
                            )}
                          </p>
                        )}
                        {trackPanelMeta.lines
                          .filter(
                            (line) =>
                              !isAdaptationLine(line) && line.kind !== "cover"
                          )
                          .map((line, i) => {
                            if (line.kind === "featuring") {
                              return (
                                <p key={i} className="release-page__track-panel-line">
                                  Featuring{" "}
                                  {line.artists.map((name, j) => (
                                    <span key={name}>
                                      {j > 0 &&
                                        (j === line.artists.length - 1 ? " and " : ", ")}
                                      <button
                                        type="button"
                                        className="release-page__person-link"
                                        onClick={() => void openPersonName(name)}
                                      >
                                        {name}
                                      </button>
                                    </span>
                                  ))}
                                </p>
                              );
                            }
                            if (line.kind === "performer") {
                              return (
                                <p key={i} className="release-page__track-panel-line">
                                  Performed by{" "}
                                  <button
                                    type="button"
                                    className="release-page__person-link"
                                    onClick={() => void openPersonName(line.artist)}
                                  >
                                    {line.artist}
                                  </button>
                                </p>
                              );
                            }
                            if (line.kind === "other") {
                              return (
                                <p key={i} className="release-page__track-panel-line">
                                  {line.text}
                                </p>
                              );
                            }
                            return null;
                          })}
                        {panelWriters.length > 0 && (
                          <p className="release-page__track-panel-writers">
                            Written by{" "}
                            {panelWriters.map((name, i) => (
                              <span key={name}>
                                {i > 0 && (i === panelWriters.length - 1 ? " and " : ", ")}
                                <button
                                  type="button"
                                  className="release-page__person-link"
                                  onClick={() => void openPersonName(name)}
                                >
                                  {name}
                                </button>
                              </span>
                            ))}
                          </p>
                        )}
                        {typeof playingTrack?.play_count === "number" &&
                          playingTrack.play_count > 0 && (
                            <p className="release-page__track-panel-line">
                              {playingTrack.play_count.toLocaleString()} reproduction
                              {playingTrack.play_count === 1 ? "" : "s"}
                            </p>
                          )}
                        {isSnapshotPlaylist && activeSnapshot ? (
                          <SnapshotStatsPanel snapshot={activeSnapshot} mobile={stacked} />
                        ) : null}
                        {bannerLayout &&
                        isSnapshotPlaylist &&
                        activeSnapshot?.record_label &&
                        showTrackPanel ? (
                          <div className="release-page__label">
                            <img
                              src={DEFAULT_LABEL_URL}
                              alt=""
                              className="release-page__label-logo"
                            />
                            <p className="release-page__label-name">
                              Distributed by{" "}
                              <span className="release-page__person-link">
                                {activeSnapshot.record_label}
                              </span>
                            </p>
                          </div>
                        ) : null}
                        {bannerLayout && panelActionTrack && hasActiveTrack ? (
                          <div className="release-page__track-actions release-page__track-actions--in-info">
                            {showLyricsAction && (
                              <button
                                type="button"
                                className="release-page__track-action"
                                data-tooltip="Lyrics"
                                aria-label="Lyrics"
                                onClick={() => {
                                  if (stacked) setMobileTrackView("tracks");
                                  tracklistRef.current?.openLyrics(panelActionTrack);
                                }}
                              >
                                <TrackActionLyricsIcon className="release-page__track-action-icon" />
                              </button>
                            )}
                            {showVersionsAction && (
                              <button
                                type="button"
                                className="release-page__track-action"
                                data-tooltip="Versions"
                                aria-label="Versions"
                                onClick={() => {
                                  if (stacked) setMobileTrackView("tracks");
                                  tracklistRef.current?.openVersions(panelActionTrack);
                                }}
                              >
                                <TrackActionVersionsIcon className="release-page__track-action-icon" />
                              </button>
                            )}
                            <button
                              type="button"
                              className="release-page__track-action"
                              data-tooltip="Add to playlist"
                              aria-label="Add to playlist"
                              onClick={() => tracklistRef.current?.openPlus(panelActionTrack)}
                            >
                              <TrackActionPlaylistIcon className="release-page__track-action-icon" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="release-page__panel-head">
                        {editPlaylist &&
                        isUserPlaylist &&
                        detail?.editable !== false &&
                        !isListeningWrapped ? (
                          <div className="user-playlist-edit__panel-fields">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Playlist name"
                              aria-label="Playlist name"
                            />
                            <textarea
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              placeholder="Short description"
                              aria-label="Playlist description"
                              rows={2}
                            />
                            <p className="release-page__type-line">
                              {`Playlist · ${allTracks.length} track${allTracks.length === 1 ? "" : "s"}`}
                            </p>
                          </div>
                        ) : (
                          <>
                            <h1 className="release-page__album-title">{detail.name}</h1>
                            <p className="release-page__type-line">
                              {!isUserPlaylist && slug === "setlists"
                                ? setlistTrackCount != null
                                  ? `Playlist · ${setlistTrackCount} track${setlistTrackCount === 1 ? "" : "s"}`
                                  : "Playlist"
                                : `Playlist · ${allTracks.length} track${allTracks.length === 1 ? "" : "s"}`}
                            </p>
                            {detail.description && (
                              <p className="release-page__source">{detail.description}</p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {!bannerLayout ? (
              <div className="release-page__panel-bottom">
                {isSnapshotPlaylist && activeSnapshot?.record_label && showTrackPanel ? (
                  <div className="release-page__label">
                    <img
                      src={DEFAULT_LABEL_URL}
                      alt=""
                      className="release-page__label-logo"
                    />
                    <p className="release-page__label-name">
                      Distributed by{" "}
                      <span className="release-page__person-link">
                        {activeSnapshot.record_label}
                      </span>
                    </p>
                  </div>
                ) : null}
                {panelActionTrack && hasActiveTrack && (
                  <div className="release-page__track-actions release-page__track-actions--above-player">
                    {showLyricsAction && (
                      <button
                        type="button"
                        className="release-page__track-action"
                        data-tooltip="Lyrics"
                        aria-label="Lyrics"
                        onClick={() => {
                          if (stacked) setMobileTrackView("tracks");
                          tracklistRef.current?.openLyrics(panelActionTrack);
                        }}
                      >
                        <TrackActionLyricsIcon className="release-page__track-action-icon" />
                      </button>
                    )}
                    {showVersionsAction && (
                      <button
                        type="button"
                        className="release-page__track-action"
                        data-tooltip="Versions"
                        aria-label="Versions"
                        onClick={() => {
                          if (stacked) setMobileTrackView("tracks");
                          tracklistRef.current?.openVersions(panelActionTrack);
                        }}
                      >
                        <TrackActionVersionsIcon className="release-page__track-action-icon" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="release-page__track-action"
                      data-tooltip="Add to playlist"
                      aria-label="Add to playlist"
                      onClick={() => tracklistRef.current?.openPlus(panelActionTrack)}
                    >
                      <TrackActionPlaylistIcon className="release-page__track-action-icon" />
                    </button>
                  </div>
                )}

                <div className="release-page__panel-footer">
                  {detail.prev || detail.next ? (
                    <div className="release-page__panel-bottom-bar">
                      {detail.prev ? (
                        <PlaylistNeighborLink
                          neighbor={{ id: detail.prev.slug, title: detail.prev.name }}
                          direction="prev"
                          onClick={() => {
                            if (editPlaylist) setEditPlaylist(false);
                            onOpenPlaylist(detail.prev!.slug);
                          }}
                        />
                      ) : (
                        <span className="release-page__neighbor-spacer" />
                      )}
                      {detail.next ? (
                        <PlaylistNeighborLink
                          neighbor={{ id: detail.next.slug, title: detail.next.name }}
                          direction="next"
                          onClick={() => {
                            if (editPlaylist) setEditPlaylist(false);
                            onOpenPlaylist(detail.next!.slug);
                          }}
                        />
                      ) : (
                        <span className="release-page__neighbor-spacer" />
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
              ) : null}
            </div>
            </MsDisclosure>

            {bannerLayout ? (
              <div className="release-page__panel-dock">
                <div className="release-page__panel-footer">
                  {detail.prev || detail.next ? (
                    <div className="release-page__panel-bottom-bar">
                      {detail.prev ? (
                        <PlaylistNeighborLink
                          neighbor={{ id: detail.prev.slug, title: detail.prev.name }}
                          direction="prev"
                          onClick={() => {
                            if (editPlaylist) setEditPlaylist(false);
                            onOpenPlaylist(detail.prev!.slug);
                          }}
                        />
                      ) : (
                        <span className="release-page__neighbor-spacer" />
                      )}
                      {detail.next ? (
                        <PlaylistNeighborLink
                          neighbor={{ id: detail.next.slug, title: detail.next.name }}
                          direction="next"
                          onClick={() => {
                            if (editPlaylist) setEditPlaylist(false);
                            onOpenPlaylist(detail.next!.slug);
                          }}
                        />
                      ) : (
                        <span className="release-page__neighbor-spacer" />
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="release-page__main">
          <div className="release-page__tracklist-pane">
            {!isUserPlaylist && slug === "setlists" ? (
              <SetlistsPlaylistContent
                ref={setlistRef}
                bandId={bandId!}
                years={detail.years ?? []}
                playingPath={playingPath}
                onPlay={(path, title, playbackKey, track) => {
                  void handlePlayTrack(
                    path,
                    title,
                    undefined,
                    track as ArtistPlaylistTrack | undefined,
                    playbackKey
                  );
                  if (track) applySetlistPanelTrack(track);
                }}
                onPanelTrack={applySetlistPanelTrack}
                onContextChange={({ tourName, trackCount, setlistId }) => {
                  setSetlistTourName(tourName);
                  setSetlistTrackCount(trackCount);
                  if (setlistId !== setlistPlaybackKey?.split(":")[0]) {
                    setSetlistPlaybackKey(null);
                  }
                }}
              />
            ) : (
              <>
                {isSnapshotPlaylist && !editPlaylist && (
                  <SnapshotPlaylistFilterBar
                    tracks={tracks}
                    onFilterStateChange={handleSnapshotFilterStateChange}
                    sortKey={trackSort.key}
                    sortDesc={trackSort.desc}
                    onSortChange={handleTrackSortChange}
                    onReset={handleFilterReset}
                    knownGenres={subgenreNames}
                  />
                )}
                <SystemPlaylistTracklist
                key={`${isUserPlaylist ? `user-${userPlaylistId}` : slug}-${liveShowsView}-${trackSort.key}-${trackSort.desc ? "d" : "a"}`}
                ref={tracklistRef}
                bandId={bandId ?? playingTrack?.navigate_band_id ?? 0}
                artistName={artistName}
                tracks={displayTracks}
                sections={
                  !isUserPlaylist &&
                  (slug === "live-story" ||
                    (isLiveShowsPlaylist && liveShowsView !== "all-tracks"))
                    ? displayLiveShowsSections
                    : undefined
                }
                liveShowsViewMode={isLiveShowsPlaylist ? liveShowsView : undefined}
                showSourceReleaseColumn={
                  !isUserPlaylist && slug !== "music-videos" && slug !== "live-shows"
                }
                musicVideosMode={!isUserPlaylist && slug === "music-videos"}
                liveShowsMode={!isUserPlaylist && slug === "live-shows"}
                catalogLiveShows={isGlobalLiveShows}
                onOpenRelease={onOpenRelease}
                onOpenArtist={onOpenArtist}
                onOpenShow={isLiveShowsPlaylist ? onOpenShow : undefined}
                originalTrackNumbers={originalTrackNumbers}
                sortKey={trackSort.key}
                sortDesc={trackSort.desc}
                onSortChange={handleTrackSortChange}
                multiArtist={showArtistInMeta}
                showTrackMeta
                userPlaylistId={isUserPlaylist ? userPlaylistId : undefined}
                onTracksChanged={isUserPlaylist ? refreshUserPlaylist : undefined}
                editMode={
                  isUserPlaylist &&
                  editPlaylist &&
                  !isListeningWrapped &&
                  detail?.tracks_editable !== false &&
                  detail?.editable !== false
                }
                playCountBubble={isListeningWrapped}
                snapshotMetadataMode={
                  isUserPlaylist &&
                  editPlaylist &&
                  isSnapshotPlaylist &&
                  detail?.editable !== false
                }
                subgenreNames={subgenreNames}
                stacked={stacked}
                compactLyricsHead={stacked || tabletPortrait}
                playingPath={playingPath}
                playbackProgress={
                  hasActiveTrack ? globalMusic.progress : 0
                }
                mobileView={mobileTrackView}
                mobileBackdropUrl={displayCover}
                onPlay={(path, title, art, track) =>
                  void handlePlayTrack(path, title, art, track)
                }
                onPanelActionsChange={handlePanelActionsChange}
                onPausePlayback={() => globalMusicPause()}
                isAdmin={isAdmin}
                hidePerformer={hidePerformerName}
                hideCoverArtist={hideCoverArtist}
              />
              </>
            )}
          </div>
        </main>
      </div>

      {isUserPlaylist && (
        <input
          ref={coverInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => void onCoverFileChange(e.target.files?.[0] ?? null)}
        />
      )}
      {deleteConfirmOpen ? (
        <ConfirmDialog
          title="Delete playlist"
          message={`Delete “${detail?.name?.trim() || "this playlist"}”? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          hideCancel
          busy={deleteBusy}
          error={deleteError}
          onConfirm={confirmDeletePlaylist}
          onClose={() => {
            if (deleteBusy) return;
            setDeleteConfirmOpen(false);
            setDeleteError(null);
          }}
        />
      ) : null}
    </div>
  );
}
