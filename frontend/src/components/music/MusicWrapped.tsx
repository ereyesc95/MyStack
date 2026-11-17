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
  fetchListeningWrapped,
  fetchUserPlaylists,
} from "../../api";
import {
  getCachedListeningWrapped,
  setCachedListeningWrapped,
} from "../../listeningWrappedCache";
import { musicStreamUrl } from "../../musicStreamUrl";
import type { ListeningWrapped } from "../../types";
import { IconCheck, IconPlus } from "../MenuIcons";
import ModalPortal, { useModalClose } from "../ModalPortal";
import {
  diskCreditFromTitle,
  trackMainTitle,
} from "./release/releaseTrackPanelMeta";

type TabId = "tracks" | "artists" | "vibes";

type Props = {
  year: number;
  onClose: () => void;
  /** @deprecated Preview uses stream URL only (never counts as a play). */
  onPlayTrack?: (
    path: string,
    artistId: number | null,
    title: string | null
  ) => void;
  onArtist?: (id: number) => void;
  onGenre?: (id: number) => void;
  /** Refresh Playlists tab after creating the Wrapped playlist. */
  onPlaylistCreated?: () => void;
};

type PreviewTrack = {
  path?: string | null;
  cover_url?: string | null;
  title?: string | null;
  title_full?: string | null;
  artist_id?: number | null;
  artist_name?: string | null;
  play_count?: number | null;
};

/** Capitalize first letter of each word without lowercasing the rest. */
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

function capitalizeAfterOpenParen(text: string): string {
  return text.replace(/\(\s*([a-zà-ÿ])/g, (m, letter: string) =>
    m.replace(letter, letter.toUpperCase())
  );
}

function formatMusicWrappedTrackTitle(t: PreviewTrack): string {
  const raw = t.title_full || t.title || "";
  const credit = diskCreditFromTitle(raw, t.artist_name);
  const stripped =
    trackMainTitle(credit.title) || credit.title || t.title || "Track";
  const looksLower =
    stripped === stripped.toLowerCase() && /[a-z]/.test(stripped);
  return capitalizeAfterOpenParen(
    looksLower ? softTitleCase(stripped) : stripped
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function MusicWrapped(props: Props) {
  return (
    <ModalPortal onClose={props.onClose}>
      <MusicWrappedPanel {...props} />
    </ModalPortal>
  );
}

function MusicWrappedPanel({
  year,
  onClose,
  onArtist,
  onGenre,
  onPlaylistCreated,
}: Props) {
  const cached = getCachedListeningWrapped(year);
  const [data, setData] = useState<ListeningWrapped | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("tracks");
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
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

  function togglePreviewTrack(t: PreviewTrack) {
    const path = (t.path || "").trim();
    if (!path) return;
    const el = previewAudioRef.current;
    if (!el) return;
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

  function renderCoverControl(t: PreviewTrack, size: "feature" | "row") {
    const path = (t.path || "").trim();
    const isThis = Boolean(path && previewPath === path && previewPlaying);
    const squareClass =
      size === "feature"
        ? "music-wrapped__feature-art music-wrapped__feature-art--square"
        : "";
    return (
      <span
        className={`music-wrapped__cover-hit music-wrapped__cover-hit--${size}${
          isThis ? " is-playing" : ""
        }`}
      >
        {t.cover_url ? (
          <img className={squareClass || undefined} src={t.cover_url} alt="" />
        ) : (
          <span
            className={`${
              squareClass || "music-wrapped__art-fallback"
            }${squareClass ? " music-wrapped__art-fallback" : ""}`}
          />
        )}
        {path ? (
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

  const playlistName = `${year} Wrapped`;

  useEffect(() => {
    let cancelled = false;
    const hit = getCachedListeningWrapped(year);
    if (hit) {
      setData(hit);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void fetchListeningWrapped(year)
      .then((payload) => {
        if (cancelled) return;
        setCachedListeningWrapped(year, payload);
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
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    void fetchUserPlaylists()
      .then(({ items }) => {
        if (cancelled) return;
        const hit = items.find(
          (p) => (p.name || "").trim().toLowerCase() === playlistName.toLowerCase()
        );
        if (hit) setPlaylistId(hit.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [playlistName]);

  const tracks = useMemo(
    () => (data?.top_tracks || []).slice(0, 100),
    [data]
  );
  const artists = useMemo(
    () => (data?.top_artists || []).slice(0, 15),
    [data]
  );
  const genres = useMemo(
    () => (data?.top_genres || []).slice(0, 15),
    [data]
  );

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
    // header / stats / tabs bottom margins
    chrome += (0.85 + 0.85 + 0.65) * rootFs;
    const maxBody = Math.max(8 * rootFs, maxPanel - chrome);

    const from = shell.getBoundingClientRect().height;
    shell.style.height = "auto";
    const natural = Math.ceil(content.scrollHeight);
    const to = Math.min(natural, Math.ceil(maxBody));

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

    // Keep the header anchored; only the bottom edge slides with tab height.
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
    tracks.length,
    artists.length,
    genres.length,
    playlistId,
    playlistBusy,
    playlistError,
  ]);

  async function addWrappedPlaylist() {
    if (playlistId != null || playlistBusy || !tracks.length) return;
    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      const created = await createUserPlaylist({
        name: playlistName,
        description: `Your most played tracks in ${year} are here!`,
      });
      if (!created.ok || created.id == null) {
        throw new Error(created.error || "Could not create playlist");
      }
      const id = created.id;
      for (const t of tracks) {
        if (!t.path) continue;
        await addTrackToPlaylist(id, {
          title: t.title_full || t.title || "Track",
          artist: t.artist_name || "",
          release: t.release || "",
          path: t.path,
          allow_wrapped_fill: true,
          module: "music",
        });
      }
      setPlaylistId(id);
      onPlaylistCreated?.();
    } catch (e) {
      setPlaylistError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlaylistBusy(false);
    }
  }

  const featuredTrack = tracks[0];
  const restTracks = tracks.slice(1);
  const featuredArtist = artists[0];
  const restArtists = artists.slice(1);
  const featuredGenre = genres[0];
  const restGenres = genres.slice(1);

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
          <p className="music-wrapped__eyebrow">Your year in sound</p>
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
            <p>No dated listening yet for {year}.</p>
            <p className="muted">
              Play tracks from today onward — Wrapped fills in as you listen.
            </p>
          </div>
        ) : data ? (
          <>
            <div className="music-wrapped__stats">
              <div>
                <strong>{data.total_plays.toLocaleString()}</strong>
                <span>plays</span>
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

            <div className="music-wrapped__tabs" role="tablist">
              {(
                [
                  ["tracks", "On repeat"],
                  ["artists", "Top artists"],
                  ["vibes", "Vibes"],
                ] as const
              ).map(([id, label]) => (
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

            <div className="music-wrapped__body-shell" ref={bodyShellRef}>
              <div
                className="music-wrapped__body"
                ref={bodyContentRef}
                key={tab}
              >
              {tab === "tracks" ? (
                <div className="music-wrapped__pane music-wrapped__pane--tracks">
                  <div className="music-wrapped__pane-scroll">
                    {tracks.length === 0 ? (
                      <p className="muted music-wrapped__status">No tracks yet.</p>
                    ) : (
                      <>
                        {featuredTrack ? (
                          <button
                            type="button"
                            className="music-wrapped__feature music-wrapped__feature--track"
                            onClick={() => togglePreviewTrack(featuredTrack)}
                          >
                            {renderCoverControl(featuredTrack, "feature")}
                            <span className="music-wrapped__feature-meta">
                              <span className="music-wrapped__feature-rank">
                                #1 On repeat
                              </span>
                              <strong>
                                {formatMusicWrappedTrackTitle(featuredTrack)}
                              </strong>
                              <em>
                                {featuredTrack.artist_name}
                                {featuredTrack.play_count != null
                                  ? ` · ${featuredTrack.play_count.toLocaleString()} plays`
                                  : ""}
                              </em>
                            </span>
                          </button>
                        ) : null}
                        <ol className="music-wrapped__list">
                          {restTracks.map((t, i) => {
                            const rank = i + 2;
                            const slim = rank > 10;
                            return (
                              <li key={t.path || t.id}>
                                <button
                                  type="button"
                                  className={`music-wrapped__row${
                                    slim ? " music-wrapped__row--slim" : ""
                                  }`}
                                  onClick={() => togglePreviewTrack(t)}
                                >
                                  {!slim ? (
                                    renderCoverControl(t, "row")
                                  ) : (
                                    <span className="music-wrapped__rank">
                                      {rank}
                                    </span>
                                  )}
                                  <span>
                                    <strong>
                                      {formatMusicWrappedTrackTitle(t)}
                                    </strong>
                                    <em>{t.artist_name}</em>
                                  </span>
                                  <span className="music-wrapped__count">
                                    {t.play_count.toLocaleString()} plays
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      </>
                    )}
                  </div>
                  {tracks.length > 0 ? (
                    <div className="music-wrapped__playlist-bar">
                      {playlistError ? (
                        <p className="error music-wrapped__playlist-err">
                          {playlistError}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className={`btn music-wrapped__playlist-btn${
                          playlistId != null
                            ? " music-wrapped__playlist-btn--done"
                            : ""
                        }`}
                        disabled={playlistBusy || playlistId != null}
                        onClick={() => void addWrappedPlaylist()}
                      >
                        {playlistId != null ? (
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
              ) : null}

              {tab === "artists" ? (
                <div className="music-wrapped__pane">
                  {artists.length === 0 ? (
                    <p className="muted music-wrapped__status">No artists yet.</p>
                  ) : (
                    <>
                      {featuredArtist ? (
                        <button
                          type="button"
                          className="music-wrapped__feature"
                          onClick={() => {
                            requestClose(() => onArtist?.(featuredArtist.id));
                          }}
                        >
                          {featuredArtist.photo_url || featuredArtist.icon_url ? (
                            <img
                              className="music-wrapped__feature-art"
                              src={
                                featuredArtist.photo_url ||
                                featuredArtist.icon_url ||
                                ""
                              }
                              alt=""
                            />
                          ) : (
                            <span className="music-wrapped__feature-art music-wrapped__art-fallback" />
                          )}
                          <span className="music-wrapped__feature-meta">
                            <span className="music-wrapped__feature-rank">
                              #1 Artist
                            </span>
                            <strong>{featuredArtist.name}</strong>
                            <em>{featuredArtist.play_count} plays</em>
                          </span>
                        </button>
                      ) : null}
                      {restArtists.length > 0 ? (
                        <ul className="music-wrapped__grid">
                          {restArtists.map((a, i) => (
                            <li key={a.id}>
                              <button
                                type="button"
                                className="music-wrapped__grid-card"
                                onClick={() => {
                                  requestClose(() => onArtist?.(a.id));
                                }}
                              >
                                {a.photo_url || a.icon_url ? (
                                  <img
                                    src={a.photo_url || a.icon_url || ""}
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
                                    {a.name}
                                  </strong>
                                  <em>{a.play_count} plays</em>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              {tab === "vibes" ? (
                <div className="music-wrapped__pane">
                  {genres.length === 0 ? (
                    <p className="muted music-wrapped__status">No vibes yet.</p>
                  ) : (
                    <>
                      {featuredGenre ? (
                        <button
                          type="button"
                          className="music-wrapped__feature"
                          onClick={() => {
                            const id = Number(featuredGenre.id);
                            if (!Number.isFinite(id)) return;
                            requestClose(() => onGenre?.(id));
                          }}
                        >
                          {featuredGenre.image_url ? (
                            <span
                              className="music-wrapped__feature-art music-wrapped__feature-art--genre"
                              style={{
                                backgroundImage: `url("${featuredGenre.image_url}")`,
                              }}
                            />
                          ) : (
                            <span className="music-wrapped__feature-art music-wrapped__art-fallback" />
                          )}
                          <span className="music-wrapped__feature-meta">
                            <span className="music-wrapped__feature-rank">
                              #1 Vibe
                            </span>
                            <strong>{featuredGenre.name}</strong>
                            <em>{featuredGenre.play_count} plays</em>
                          </span>
                        </button>
                      ) : null}
                      {restGenres.length > 0 ? (
                        <ul className="music-wrapped__grid">
                          {restGenres.map((g, i) => (
                            <li key={String(g.id)}>
                              <button
                                type="button"
                                className="music-wrapped__grid-card"
                                onClick={() => {
                                  const id = Number(g.id);
                                  if (!Number.isFinite(id)) return;
                                  requestClose(() => onGenre?.(id));
                                }}
                              >
                                {g.image_url ? (
                                  <span
                                    className="music-wrapped__grid-genre"
                                    style={{
                                      backgroundImage: `url("${g.image_url}")`,
                                    }}
                                  />
                                ) : (
                                  <span className="music-wrapped__art-fallback music-wrapped__art-fallback--round" />
                                )}
                                <span>
                                  <strong>
                                    <span className="music-wrapped__grid-rank">
                                      #{i + 2}
                                    </span>{" "}
                                    {g.name}
                                  </strong>
                                  <em>{g.play_count} plays</em>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
  );
}
