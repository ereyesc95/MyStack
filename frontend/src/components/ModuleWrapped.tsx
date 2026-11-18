import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addTrackToPlaylist,
  createUserPlaylist,
  fetchModuleWrapped,
  fetchUserPlaylists,
} from "../api";
import {
  getCachedModuleWrapped,
  setCachedModuleWrapped,
} from "../moduleWrappedCache";
import type {
  ModuleWrapped,
  ModuleWrappedItem,
  ModuleWrappedKind,
  ModuleWrappedTrack,
} from "../types";
import { musicStreamUrl } from "../musicStreamUrl";
import {
  diskCreditFromTitle,
  trackMainTitle,
} from "./music/release/releaseTrackPanelMeta";
import { IconCheck, IconPlus, IconTrophy } from "./MenuIcons";
import ModalPortal, { useModalClose } from "./ModalPortal";

type TabId = "items" | "videos" | "groups" | "franchises" | "tracks" | "vibes";

export type ModuleWrappedBrowseTarget = {
  module: ModuleWrappedKind;
  id: string;
  title: string;
  franchiseId?: string | null;
  groupId?: string | null;
};

type Props = {
  module: ModuleWrappedKind;
  year: number;
  onClose: () => void;
  /** Open a leaf / episode / file / hobby item from the items list. */
  onOpenItem?: (item: ModuleWrappedItem) => void;
  /** Open a franchise / folder / collection from groups (or browse CTA). */
  onBrowseTop?: (target: ModuleWrappedBrowseTarget) => void;
  onOpenVibe?: (item: ModuleWrappedItem) => void;
  /** Refresh Music playlists after filling `{year} Wrapped`. */
  onPlaylistCreated?: () => void;
};

/** Capitalize first letter of each word without lowercasing the rest (keeps `(Don't…)`). */
function softTitleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const i = w.search(/[A-Za-zÀ-ÿ]/);
      if (i < 0) return w;
      return w.slice(0, i) + w.charAt(i).toUpperCase() + w.slice(i + 1);
    })
    .join(" ");
}

/** Fix `(don't…)` / `(drown…)` without lowercasing the rest of the title. */
function capitalizeAfterOpenParen(text: string): string {
  return text.replace(/\(\s*([a-zà-ÿ])/g, (m, letter: string) =>
    m.replace(letter, letter.toUpperCase())
  );
}

function formatMediaWrappedTrack(t: ModuleWrappedTrack): {
  title: string;
  source: string;
  plays: string;
} {
  const raw = t.title_full || t.title || "";
  const credit = diskCreditFromTitle(raw, t.artist_name);
  const stripped =
    trackMainTitle(credit.title) || credit.title || t.title || "Track";
  // Prefer disk casing; only soft-cap when the whole title looks lowercased.
  const looksLower = stripped === stripped.toLowerCase() && /[a-z]/.test(stripped);
  const title = capitalizeAfterOpenParen(
    looksLower ? softTitleCase(stripped) : stripped
  );
  const source = (t.source_title || "").trim();
  const plays = `${t.play_count.toLocaleString()} plays`;
  return { title, source, plays };
}

const MEDIA_WITH_TRACKS: ModuleWrappedKind[] = [
  "series",
  "movies",
  "books",
  "games",
];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function usesPortraitCovers(module: ModuleWrappedKind): boolean {
  return MEDIA_WITH_TRACKS.includes(module);
}

export default function ModuleWrapped(props: Props) {
  return (
    <ModalPortal onClose={props.onClose}>
      <ModuleWrappedPanel {...props} />
    </ModalPortal>
  );
}

function ModuleWrappedPanel({
  module,
  year,
  onClose,
  onOpenItem,
  onBrowseTop,
  onOpenVibe,
  onPlaylistCreated,
}: Props) {
  const cached = getCachedModuleWrapped(module, year);
  const [data, setData] = useState<ModuleWrapped | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("items");
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [playlistFilled, setPlaylistFilled] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyShellRef = useRef<HTMLDivElement>(null);
  const bodyContentRef = useRef<HTMLDivElement>(null);
  const heightReadyRef = useRef(false);
  const pinnedTopRef = useRef<number | null>(null);
  const requestClose = useModalClose(onClose);

  useEffect(() => {
    const el = document.createElement("audio");
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    previewAudioRef.current = el;
    const onPlay = () => setPreviewPlaying(true);
    const onPause = () => setPreviewPlaying(false);
    const onEnded = () => {
      setPreviewPlaying(false);
      setPreviewPath(null);
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.pause();
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      previewAudioRef.current = null;
    };
  }, []);
  const playlistName = `${year} Wrapped`;
  const portrait = usesPortraitCovers(module);

  useEffect(() => {
    let cancelled = false;
    // Refresh every open so enrich / top_tracks changes land.
    setLoading(true);
    setError(null);
    void fetchModuleWrapped(module, year)
      .then((payload) => {
        if (cancelled) return;
        setCachedModuleWrapped(module, year, payload);
        setData(payload);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load Wrapped");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [module, year]);

  useEffect(() => {
    let cancelled = false;
    void fetchUserPlaylists()
      .then((list) => {
        if (cancelled) return;
        const hit = list.find(
          (p) => (p.name || "").trim().toLowerCase() === playlistName.toLowerCase()
        );
        if (hit?.id != null) setPlaylistId(hit.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [playlistName]);

  const items = useMemo(
    () => (data?.top_items || []).slice(0, 100),
    [data]
  );
  const videos = useMemo(
    () => (data?.top_videos || []).slice(0, 100),
    [data]
  );
  const groups = useMemo(
    () => (data?.top_groups || []).slice(0, 15),
    [data]
  );
  const franchises = useMemo(
    () => (data?.top_franchises || []).slice(0, 15),
    [data]
  );
  const tracks = useMemo(
    () => (data?.top_tracks || []).slice(0, 100),
    [data]
  );
  const vibes = useMemo(
    () => (data?.top_vibes || []).slice(0, 40),
    [data]
  );
  const countLabel = data?.count_label || "plays";
  const hideItemCovers = Boolean(data?.hide_item_covers) || module === "files";
  const showTracksTab = MEDIA_WITH_TRACKS.includes(module) && tracks.length > 0;

  const tabDefs = useMemo(() => {
    const defs: [TabId, string][] = [];
    if (items.length > 0) {
      defs.push(["items", data?.items_tab || "On repeat"]);
    }
    if (videos.length > 0) {
      defs.push(["videos", data?.videos_tab || "Top videos"]);
    }
    if (groups.length > 0) {
      defs.push(["groups", data?.groups_tab || "Top"]);
    }
    if (franchises.length > 0) {
      defs.push(["franchises", data?.franchises_tab || "Top franchises"]);
    }
    if (showTracksTab) {
      defs.push(["tracks", data?.tracks_tab || "Top tracks"]);
    }
    if (vibes.length > 0) {
      defs.push(["vibes", data?.vibes_tab || "Vibes"]);
    }
    return defs;
  }, [
    data,
    items.length,
    videos.length,
    groups.length,
    franchises.length,
    showTracksTab,
    vibes.length,
  ]);

  useEffect(() => {
    if (!tabDefs.length) return;
    if (!tabDefs.some(([id]) => id === tab)) {
      setTab(tabDefs[0][0]);
    }
  }, [tabDefs, tab]);

  useLayoutEffect(() => {
    const shell = bodyShellRef.current;
    const content = bodyContentRef.current;
    const panel = panelRef.current;
    if (!shell || !content || !panel) return;

    const rootFs =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const maxPanel = Math.min(window.innerHeight * 0.88, 44 * rootFs);
    const panelStyle = getComputedStyle(panel);
    let chrome =
      parseFloat(panelStyle.paddingTop) + parseFloat(panelStyle.paddingBottom);
    for (const child of Array.from(panel.children)) {
      if (child === shell) continue;
      chrome += (child as HTMLElement).getBoundingClientRect().height;
    }
    chrome += (0.85 + 0.85 + 0.65) * rootFs;
    const maxBody = Math.max(8 * rootFs, maxPanel - chrome);
    // Media Wrapped should feel as tall as Music Wrapped even with fewer rows.
    const minBody = MEDIA_WITH_TRACKS.includes(module)
      ? Math.min(maxBody, Math.round(22 * rootFs))
      : 0;

    const from = shell.getBoundingClientRect().height;
    shell.style.height = "auto";
    const natural = Math.ceil(content.scrollHeight);
    const to = Math.max(minBody, Math.min(natural, Math.ceil(maxBody)));

    if (!heightReadyRef.current || prefersReducedMotion()) {
      shell.style.height = `${to}px`;
      heightReadyRef.current = true;
    } else if (Math.abs(from - to) < 1) {
      shell.style.height = `${to}px`;
    } else {
      shell.style.height = `${from}px`;
      void shell.offsetHeight;
      shell.style.height = `${to}px`;
    }

    if (pinnedTopRef.current == null) {
      pinnedTopRef.current = panel.getBoundingClientRect().top;
      panel.style.alignSelf = "flex-start";
      panel.style.marginTop = `${pinnedTopRef.current}px`;
    }
  }, [
    tab,
    loading,
    error,
    data,
    items.length,
    videos.length,
    groups.length,
    franchises.length,
    tracks.length,
    vibes.length,
    playlistId,
    playlistBusy,
    playlistError,
  ]);

  async function addWrappedPlaylist() {
    if (playlistBusy || playlistFilled || !tracks.length) return;
    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      let id = playlistId;
      if (id == null) {
        // Re-check so Music + Series/Movies fills share one `{year} Wrapped`.
        const list = await fetchUserPlaylists().catch(() => []);
        const hit = list.find(
          (p) =>
            (p.name || "").trim().toLowerCase() === playlistName.toLowerCase()
        );
        if (hit?.id != null) {
          id = hit.id;
          setPlaylistId(id);
        } else {
          const created = await createUserPlaylist({
            name: playlistName,
            description: `Your most played tracks in ${year} are here!`,
          });
          if (!created.ok || created.id == null) {
            throw new Error(created.error || "Could not create playlist");
          }
          id = created.id;
          setPlaylistId(id);
        }
      }
      for (const t of tracks) {
        if (!t.path) continue;
        await addTrackToPlaylist(id, {
          title: t.title_full || t.title || "Track",
          artist: t.artist_name || "",
          release: t.release || "",
          path: t.path,
          allow_wrapped_fill: true,
          module,
        });
      }
      setPlaylistFilled(true);
      onPlaylistCreated?.();
      window.dispatchEvent(new CustomEvent("playlists-changed"));
    } catch (e) {
      setPlaylistError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlaylistBusy(false);
    }
  }

  const featuredItem = items[0];
  const restItems = items.slice(1);
  const featuredVideo = videos[0];
  const restVideos = videos.slice(1);
  const featuredGroup = groups[0];
  const restGroups = groups.slice(1);
  const featuredFranchise = franchises[0];
  const restFranchises = franchises.slice(1);
  const featuredTrack = tracks[0];
  const restTracks = tracks.slice(1);
  const featuredVibe = vibes[0];
  const restVibes = vibes.slice(1);

  const artClass = portrait
    ? "music-wrapped__feature-art music-wrapped__feature-art--portrait"
    : "music-wrapped__feature-art music-wrapped__feature-art--square";
  const rowArtClass = portrait ? "music-wrapped__row-art--portrait" : "";

  function rowCountLabel(row: ModuleWrappedItem): string {
    return (row.count_label || countLabel || "plays").trim() || "plays";
  }

  function browseFromGroup(g: ModuleWrappedItem) {
    requestClose(() =>
      onBrowseTop?.({
        module,
        id: g.id,
        title: g.title || g.name || g.id,
        franchiseId: g.franchise_id,
        groupId: g.group_id,
      })
    );
  }

  function openWrappedItem(item: ModuleWrappedItem) {
    requestClose(() => onOpenItem?.(item));
  }

  function renderRankedList(
    listFeatured: ModuleWrappedItem | undefined,
    listRest: ModuleWrappedItem[],
    rankLabel: string,
    opts?: { hideCovers?: boolean }
  ) {
    const hideCovers = Boolean(opts?.hideCovers);
    return (
      <div className="music-wrapped__pane music-wrapped__pane--tracks">
        <div className="music-wrapped__pane-scroll">
          {listFeatured ? (
            <button
              type="button"
              className="music-wrapped__feature music-wrapped__feature--track"
              onClick={() => openWrappedItem(listFeatured)}
            >
              {!hideCovers ? (
                listFeatured.cover_url || listFeatured.photo_url ? (
                  <img
                    className={artClass}
                    src={
                      listFeatured.cover_url || listFeatured.photo_url || ""
                    }
                    alt=""
                  />
                ) : (
                  <span
                    className={`${artClass} music-wrapped__art-fallback`}
                  />
                )
              ) : (
                <span
                  className={`${artClass} music-wrapped__feature-trophy`}
                  aria-hidden
                >
                  <IconTrophy className="music-wrapped__trophy-icon" />
                </span>
              )}
              <span className="music-wrapped__feature-meta">
                <span className="music-wrapped__feature-rank">{rankLabel}</span>
                <strong>{listFeatured.title}</strong>
                <em>
                  {listFeatured.subtitle}
                  {listFeatured.play_count != null
                    ? `${listFeatured.subtitle ? " · " : ""}${listFeatured.play_count.toLocaleString()} ${rowCountLabel(listFeatured)}`
                    : ""}
                </em>
              </span>
            </button>
          ) : null}
          <ol className="music-wrapped__list">
            {listRest.map((t, i) => {
              const rank = i + 2;
              const slim = rank > 10 || hideCovers;
              return (
                <li key={t.id || t.path || rank}>
                  <button
                    type="button"
                    className={`music-wrapped__row${
                      slim ? " music-wrapped__row--slim" : ""
                    }${rowArtClass && !hideCovers ? ` ${rowArtClass}` : ""}`}
                    onClick={() => openWrappedItem(t)}
                  >
                    {!slim && !hideCovers ? (
                      t.cover_url || t.photo_url ? (
                        <img
                          src={t.cover_url || t.photo_url || ""}
                          alt=""
                        />
                      ) : (
                        <span className="music-wrapped__art-fallback" />
                      )
                    ) : (
                      <span className="music-wrapped__rank">{rank}</span>
                    )}
                    <span>
                      <strong>{t.title}</strong>
                      {t.subtitle ? <em>{t.subtitle}</em> : null}
                    </span>
                    <span className="music-wrapped__count">
                      {t.play_count.toLocaleString()} {rowCountLabel(t)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    );
  }

  function renderGroupGrid(
    listFeatured: ModuleWrappedItem | undefined,
    listRest: ModuleWrappedItem[],
    rankLabel: string
  ) {
    const hideCovers = hideItemCovers;
    return (
      <div className="music-wrapped__pane">
        {listFeatured ? (
          <button
            type="button"
            className="music-wrapped__feature"
            onClick={() => browseFromGroup(listFeatured)}
          >
            {hideCovers ? (
              <span
                className={`${artClass} music-wrapped__feature-trophy`}
                aria-hidden
              >
                <IconTrophy className="music-wrapped__trophy-icon" />
              </span>
            ) : listFeatured.cover_url || listFeatured.photo_url ? (
              <img
                className={artClass}
                src={
                  listFeatured.cover_url || listFeatured.photo_url || ""
                }
                alt=""
              />
            ) : (
              <span className={`${artClass} music-wrapped__art-fallback`} />
            )}
            <span className="music-wrapped__feature-meta">
              <span className="music-wrapped__feature-rank">{rankLabel}</span>
              <strong>{listFeatured.title}</strong>
              <em>
                {listFeatured.play_count} {rowCountLabel(listFeatured)}
              </em>
            </span>
          </button>
        ) : null}
        {listRest.length > 0 ? (
          <ul
            className={`music-wrapped__grid${
              hideCovers ? " music-wrapped__grid--no-covers" : ""
            }`}
          >
            {listRest.map((a, i) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="music-wrapped__grid-card"
                  onClick={() => browseFromGroup(a)}
                >
                  {hideCovers ? (
                    <span className="music-wrapped__grid-rank-only">
                      #{i + 2}
                    </span>
                  ) : a.cover_url || a.photo_url ? (
                    <img src={a.cover_url || a.photo_url || ""} alt="" />
                  ) : (
                    <span className="music-wrapped__art-fallback music-wrapped__art-fallback--round" />
                  )}
                  <span>
                    <strong>
                      {!hideCovers ? (
                        <span className="music-wrapped__grid-rank">
                          #{i + 2}
                        </span>
                      ) : null}{" "}
                      {a.title}
                    </strong>
                    <em>
                      {a.play_count} {rowCountLabel(a)}
                    </em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  function togglePreviewTrack(t: ModuleWrappedTrack) {
    const path = (t.path || "").trim();
    if (!path) return;
    const el = previewAudioRef.current;
    if (!el) return;
    // Stream only — never POST /music/play (no Wrapped/listening count).
    const url = musicStreamUrl(path);
    if (previewPath === path) {
      if (!el.paused) {
        el.pause();
        setPreviewPlaying(false);
      } else {
        void el.play().catch(() => setPreviewPlaying(false));
      }
      return;
    }
    el.src = url;
    setPreviewPath(path);
    void el.play().catch(() => {
      setPreviewPlaying(false);
      setPreviewPath(null);
    });
  }

  function renderCoverControl(
    t: ModuleWrappedTrack,
    squareClass: string,
    size: "feature" | "row"
  ) {
    const path = (t.path || "").trim();
    const isThis = Boolean(path && previewPath === path && previewPlaying);
    const showBtn = Boolean(path);
    return (
      <span
        className={`music-wrapped__cover-hit music-wrapped__cover-hit--${size}${
          isThis ? " is-playing" : ""
        }`}
      >
        {t.cover_url ? (
          <img className={squareClass} src={t.cover_url} alt="" />
        ) : (
          <span className={`${squareClass} music-wrapped__art-fallback`} />
        )}
        {showBtn ? (
          <button
            type="button"
            className="music-wrapped__cover-play"
            aria-label={isThis ? "Pause preview" : "Play preview"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              togglePreviewTrack(t);
            }}
          >
            {isThis ? (
              <span className="music-wrapped__cover-pause" />
            ) : (
              <span className="music-wrapped__cover-triangle" />
            )}
          </button>
        ) : null}
      </span>
    );
  }

  function renderTrackList(
    listFeatured: ModuleWrappedTrack | undefined,
    listRest: ModuleWrappedTrack[],
    withPlaylistBar: boolean
  ) {
    const featuredFmt = listFeatured
      ? formatMediaWrappedTrack(listFeatured)
      : null;
    return (
      <div className="music-wrapped__pane music-wrapped__pane--tracks">
        <div className="music-wrapped__pane-scroll">
          {listFeatured && featuredFmt ? (
            <button
              type="button"
              className="music-wrapped__feature music-wrapped__feature--track"
              onClick={() => togglePreviewTrack(listFeatured)}
            >
              {renderCoverControl(
                listFeatured,
                "music-wrapped__feature-art music-wrapped__feature-art--square",
                "feature"
              )}
              <span className="music-wrapped__feature-meta">
                <span className="music-wrapped__feature-rank">#1 On repeat</span>
                <strong>{featuredFmt.title}</strong>
                <em>
                  {[featuredFmt.source, featuredFmt.plays]
                    .filter(Boolean)
                    .join(" · ")}
                </em>
              </span>
            </button>
          ) : null}
          <ol className="music-wrapped__list">
            {listRest.map((t, i) => {
              const rank = i + 2;
              const slim = rank > 10;
              const fmt = formatMediaWrappedTrack(t);
              return (
                <li key={String(t.id || t.path || rank)}>
                  <button
                    type="button"
                    className={`music-wrapped__row${
                      slim ? " music-wrapped__row--slim" : ""
                    }`}
                    onClick={() => togglePreviewTrack(t)}
                  >
                    {!slim ? (
                      renderCoverControl(t, "", "row")
                    ) : (
                      <span className="music-wrapped__rank">{rank}</span>
                    )}
                    <span>
                      <strong>{fmt.title}</strong>
                      {fmt.source ? <em>{fmt.source}</em> : null}
                    </span>
                    <span className="music-wrapped__count">{fmt.plays}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        {withPlaylistBar ? (
          <div className="music-wrapped__playlist-bar">
            {playlistError ? (
              <p className="error music-wrapped__playlist-err">{playlistError}</p>
            ) : null}
            <button
              type="button"
              className={`btn music-wrapped__playlist-btn${
                playlistFilled ? " music-wrapped__playlist-btn--done" : ""
              }`}
              disabled={playlistBusy || playlistFilled}
              onClick={() => void addWrappedPlaylist()}
            >
              {playlistFilled ? (
                <>
                  <IconCheck className="music-wrapped__playlist-icon" />
                  Added to your playlists
                </>
              ) : playlistBusy ? (
                "Adding…"
              ) : (
                <>
                  <IconPlus className="music-wrapped__playlist-icon" />
                  Add to your playlists
                </>
              )}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const vibeArtClass =
    "music-wrapped__feature-art music-wrapped__feature-art--round";

  return (
    <div
      ref={panelRef}
      className="music-wrapped"
      role="dialog"
      aria-modal="true"
      aria-label={`${year} Wrapped`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="music-wrapped__header">
        <p className="music-wrapped__eyebrow">
          {data?.eyebrow || "Your year"}
        </p>
        <h2 className="music-wrapped__title">{year} Wrapped</h2>
        <button
          type="button"
          className="music-wrapped__close"
          onClick={() => requestClose()}
          aria-label="Close"
        >
          ×
        </button>
      </header>

      {loading ? (
        <p className="muted music-wrapped__status">Loading…</p>
      ) : error ? (
        <p className="error music-wrapped__status">{error}</p>
      ) : data?.empty ? (
        <div className="music-wrapped__empty">
          <p>No dated activity yet for {year}.</p>
          <p className="muted">{data.empty_hint}</p>
        </div>
      ) : data ? (
        <>
          <div className="music-wrapped__stats">
            <div>
              <strong>{data.total_plays.toLocaleString()}</strong>
              <span>{countLabel}</span>
            </div>
            <div>
              <strong>{data.active_days}</strong>
              <span>days active</span>
            </div>
            <div>
              <strong>{data.current_streak}</strong>
              <span>day streak</span>
            </div>
            <div>
              <strong>{data.longest_streak}</strong>
              <span>best streak</span>
            </div>
          </div>

          {tabDefs.length > 0 ? (
            <div className="music-wrapped__tabs" role="tablist">
              {tabDefs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className={tab === id ? "active" : ""}
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="music-wrapped__body-shell" ref={bodyShellRef}>
            <div
              className="music-wrapped__body"
              ref={bodyContentRef}
              key={tab}
            >
              {tab === "items" && items.length > 0
                ? renderRankedList(
                    featuredItem,
                    restItems,
                    data.items_rank,
                    { hideCovers: hideItemCovers }
                  )
                : null}

              {tab === "videos" && videos.length > 0
                ? renderRankedList(
                    featuredVideo,
                    restVideos,
                    data.videos_rank || "#1 Video"
                  )
                : null}

              {tab === "groups" && groups.length > 0
                ? renderGroupGrid(
                    featuredGroup,
                    restGroups,
                    data.groups_rank
                  )
                : null}

              {tab === "franchises" && franchises.length > 0
                ? renderGroupGrid(
                    featuredFranchise,
                    restFranchises,
                    data.franchises_rank || "#1 Franchise"
                  )
                : null}

              {tab === "tracks" && showTracksTab
                ? renderTrackList(featuredTrack, restTracks, true)
                : null}

              {tab === "vibes" && vibes.length > 0 ? (
                <div className="music-wrapped__pane">
                  {featuredVibe ? (
                    <button
                      type="button"
                      className="music-wrapped__feature"
                      onClick={() => {
                        if (
                          module === "files" ||
                          module === "hobbies" ||
                          module === "photos"
                        ) {
                          openWrappedItem(featuredVibe);
                        } else {
                          requestClose(() => onOpenVibe?.(featuredVibe));
                        }
                      }}
                    >
                      {hideItemCovers ? (
                        <span
                          className={`${artClass} music-wrapped__feature-trophy`}
                          aria-hidden
                        >
                          <IconTrophy className="music-wrapped__trophy-icon" />
                        </span>
                      ) : featuredVibe.image_url || featuredVibe.cover_url ? (
                        featuredVibe.image_url && !featuredVibe.cover_url ? (
                          <span
                            className="music-wrapped__feature-art music-wrapped__feature-art--genre"
                            style={{
                              backgroundImage: `url("${featuredVibe.image_url}")`,
                            }}
                          />
                        ) : (
                          <img
                            className={
                              module === "hobbies" || module === "photos"
                                ? artClass
                                : vibeArtClass
                            }
                            src={
                              featuredVibe.cover_url ||
                              featuredVibe.image_url ||
                              ""
                            }
                            alt=""
                          />
                        )
                      ) : (
                        <span
                          className={`${
                            module === "hobbies" || module === "photos"
                              ? artClass
                              : vibeArtClass
                          } music-wrapped__art-fallback`}
                        />
                      )}
                      <span className="music-wrapped__feature-meta">
                        <span className="music-wrapped__feature-rank">
                          {module === "files" ||
                          module === "hobbies" ||
                          module === "photos"
                            ? "#1 Only once"
                            : module === "games"
                              ? "#1 Platform"
                              : "#1 Vibe"}
                        </span>
                        <strong>{featuredVibe.title}</strong>
                        <em>
                          {featuredVibe.subtitle
                            ? `${featuredVibe.subtitle} · `
                            : ""}
                          {featuredVibe.play_count} {countLabel}
                        </em>
                      </span>
                    </button>
                  ) : null}
                  {restVibes.length > 0 ? (
                    <ul
                      className={`music-wrapped__grid${
                        hideItemCovers ? " music-wrapped__grid--no-covers" : ""
                      }`}
                    >
                      {restVibes.map((g, i) => (
                        <li key={String(g.id)}>
                          <button
                            type="button"
                            className="music-wrapped__grid-card"
                            onClick={() => {
                              if (
                                module === "files" ||
                                module === "hobbies" ||
                                module === "photos"
                              ) {
                                openWrappedItem(g);
                              } else {
                                requestClose(() => onOpenVibe?.(g));
                              }
                            }}
                          >
                            {hideItemCovers ? (
                              <span className="music-wrapped__grid-rank-only">
                                #{i + 2}
                              </span>
                            ) : g.image_url && !g.cover_url ? (
                              <span
                                className="music-wrapped__grid-genre"
                                style={{
                                  backgroundImage: `url("${g.image_url}")`,
                                }}
                              />
                            ) : g.cover_url || g.photo_url ? (
                              <img
                                className="music-wrapped__grid-card-art--round"
                                src={g.cover_url || g.photo_url || ""}
                                alt=""
                              />
                            ) : (
                              <span className="music-wrapped__art-fallback music-wrapped__art-fallback--round" />
                            )}
                            <span>
                              <strong>
                                <span className="music-wrapped__grid-rank">
                                  #{i + 2}
                                </span>{" "}
                                {g.title}
                              </strong>
                              <em>
                                {g.play_count} {countLabel}
                              </em>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
