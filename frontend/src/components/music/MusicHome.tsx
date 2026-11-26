import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchMusicDashPreview } from "../../api";
import type { MusicDashboard } from "../../types";
import { EMPTY_DASHBOARD } from "../../types";
import DashMorphCard from "../DashMorphCard";
import DashPaneLabel from "../DashPaneLabel";
import { useDashCardReveal } from "../DashHoverTitle";
import {
  prefetchDashArt,
  useDashPaneExpand,
} from "../useDashPaneExpand";

const PHONE_MAX_WIDTH = 900;
const PHONE_PORTRAIT_MAX_WIDTH = 480;
const TABLET_PORTRAIT_MAX_WIDTH = 1366;
/** Landscape tablets (Surface Pro, iPad) — short viewport; excludes 1080p desktops. */
const TABLET_LANDSCAPE_MAX_HEIGHT = 950;

function hasTouchScreen(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.maxTouchPoints > 0;
}

const DESKTOP_PANE_ITEMS = 11;
const DESKTOP_WIDE_PANE_ITEMS = 15;
const DESKTOP_WIDE_MIN_WIDTH = 1600;
const TABLET_LANDSCAPE_ITEMS = 8;
const TABLET_PORTRAIT_ITEMS = 6;
const MOBILE_LANDSCAPE_ITEMS = 6;
const MOBILE_PORTRAIT_ITEMS = 4;

type DashLayout =
  | "desktop"
  | "desktop-wide"
  | "tablet-landscape"
  | "tablet-portrait"
  | "mobile-landscape"
  | "mobile-portrait";

function resolveDashLayout(): DashLayout {
  if (typeof window === "undefined") return "desktop";
  const width = window.innerWidth;
  const height = window.innerHeight;
  const landscape = window.matchMedia("(orientation: landscape)").matches;

  if (landscape) {
    if (width <= PHONE_MAX_WIDTH) return "mobile-landscape";
    if (
      hasTouchScreen() &&
      height <= TABLET_LANDSCAPE_MAX_HEIGHT &&
      width > PHONE_MAX_WIDTH
    ) {
      return "tablet-landscape";
    }
    return width >= DESKTOP_WIDE_MIN_WIDTH ? "desktop-wide" : "desktop";
  }

  if (width <= PHONE_PORTRAIT_MAX_WIDTH) return "mobile-portrait";
  if (width <= TABLET_PORTRAIT_MAX_WIDTH) return "tablet-portrait";
  return width >= DESKTOP_WIDE_MIN_WIDTH ? "desktop-wide" : "desktop";
}

function useDashboardLayout() {
  const [layout, setLayout] = useState<DashLayout>(resolveDashLayout);

  useLayoutEffect(() => {
    const update = () => setLayout(resolveDashLayout());
    const landscapeMq = window.matchMedia("(orientation: landscape)");
    landscapeMq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      landscapeMq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return layout;
}

function paneItemLimit(layout: DashLayout) {
  switch (layout) {
    case "tablet-landscape":
      return TABLET_LANDSCAPE_ITEMS;
    case "tablet-portrait":
      return TABLET_PORTRAIT_ITEMS;
    case "mobile-portrait":
      return MOBILE_PORTRAIT_ITEMS;
    case "mobile-landscape":
      return MOBILE_LANDSCAPE_ITEMS;
    case "desktop-wide":
      return DESKTOP_WIDE_PANE_ITEMS;
    default:
      return DESKTOP_PANE_ITEMS;
  }
}

const DASH_LAYOUT_CLASS: Record<DashLayout, string> = {
  desktop: "",
  "desktop-wide": "",
  "tablet-landscape": " music-dashboard--tablet-landscape",
  "tablet-portrait": " music-dashboard--tablet-portrait",
  "mobile-landscape": " music-dashboard--mobile-landscape",
  "mobile-portrait": " music-dashboard--mobile-portrait",
};

function slicePane<T>(items: T[], limit: number) {
  return items.slice(0, limit);
}

function placeholderCount(itemCount: number, limit: number) {
  return Math.max(0, limit - itemCount);
}

type Props = {
  data: MusicDashboard | null;
  loading?: boolean;
  playingPath?: string | null;
  /** When false (paused/stopped), hide the On Repeat active ring. */
  isPlaying?: boolean;
  playerBarVisible?: boolean;
  onPlayTrack: (path: string, artistId: number | null, title: string | null) => void;
  onArtist: (id: number) => void;
  onRelease: (
    artistId: number,
    releaseId: string,
    meta?: { artistName?: string | null; title?: string | null }
  ) => void;
  onGenre: (id: number) => void;
  onCountry: (country: { id?: number; name: string }) => void;
};

type PlaceholderVariant =
  | "square"
  | "landscape"
  | "circle"
  | "icon-circle"
  | "flag";

function DashPlaceholder({ variant }: { variant: PlaceholderVariant }) {
  const shape =
    variant === "square"
      ? "square"
      : variant === "circle" || variant === "icon-circle"
        ? "circle"
        : variant === "flag"
          ? "flag"
          : "landscape";
  return (
    <div
      className={`dash-morph dash-morph--${shape} dash-placeholder-item`}
      aria-hidden
    >
      <span className="dash-morph__frame dash-placeholder" />
    </div>
  );
}

function PlaceholderTiles({
  count,
  variant,
}: {
  count: number;
  variant: PlaceholderVariant;
}) {
  if (count <= 0) return null;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <DashPlaceholder key={i} variant={variant} />
      ))}
    </>
  );
}

export default function MusicHome({
  data,
  loading,
  playingPath = null,
  isPlaying = false,
  playerBarVisible = false,
  onPlayTrack,
  onArtist,
  onRelease,
  onGenre,
  onCountry,
}: Props) {
  const dash = data ?? EMPTY_DASHBOARD;
  const layout = useDashboardLayout();
  const paneLimit = paneItemLimit(layout);

  const topTracks = slicePane(dash.top_tracks, paneLimit);
  const topArtists = slicePane(dash.top_artists, paneLimit);
  const topReleases = slicePane(dash.top_releases ?? [], paneLimit);
  const topGenres = slicePane(dash.top_genres, paneLimit);
  const topCountries = slicePane(dash.top_countries, paneLimit);

  const trackPlaceholders = placeholderCount(topTracks.length, paneLimit);
  const artistPlaceholders = placeholderCount(topArtists.length, paneLimit);
  const releasePlaceholders = placeholderCount(topReleases.length, paneLimit);
  const genrePlaceholders = placeholderCount(topGenres.length, paneLimit);
  const countryPlaceholders = placeholderCount(topCountries.length, paneLimit);

  const dashClass = `${DASH_LAYOUT_CLASS[layout]}${
    playerBarVisible ? " music-dashboard--player-active" : ""
  }`;
  const tracksScrollRef = useRef<HTMLDivElement>(null);
  const { coarse, revealedId, onCardActivate } = useDashCardReveal();
  const tracksExpand = useDashPaneExpand(revealedId, coarse);
  const artistsExpand = useDashPaneExpand(revealedId, coarse);
  const releasesExpand = useDashPaneExpand(revealedId, coarse);
  const genresExpand = useDashPaneExpand(revealedId, coarse);
  const countriesExpand = useDashPaneExpand(revealedId, coarse);

  useEffect(() => {
    prefetchDashArt([
      ...topTracks.flatMap((t) => [
        t.banner_url,
        t.landscape_url,
        t.cover_url,
        t.logo_collapsed_url,
        t.logo_url,
        t.icon_url,
      ]),
      ...topArtists.flatMap((a) => [
        a.banner_url,
        a.landscape_url,
        a.photo_url,
        a.logo_collapsed_url,
        a.logo_url,
        a.icon_url,
      ]),
      ...topReleases.flatMap((r) => [
        r.banner_url,
        r.landscape_url,
        r.cover_url,
        r.logo_collapsed_url,
        r.logo_url,
        r.artist_logo_collapsed_url,
        r.artist_logo_url,
        r.artist_icon_url,
      ]),
      ...topGenres.map((g) => g.image_url),
      ...topCountries.flatMap((c) => [
        c.banner_url,
        c.landscape_url,
        c.cover_url,
      ]),
    ]);
  }, [topTracks, topArtists, topReleases, topGenres, topCountries]);

  useLayoutEffect(() => {
    if (
      (layout !== "mobile-portrait" && layout !== "mobile-landscape") ||
      !playingPath
    ) {
      return;
    }
    const scroller = tracksScrollRef.current;
    if (!scroller) return;
    const active = scroller.querySelector<HTMLElement>(
      `.dash-track.active[data-track-path="${CSS.escape(playingPath)}"]`
    );
    if (!active) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const left =
      active.offsetLeft -
      scroller.clientWidth / 2 +
      active.clientWidth / 2;
    scroller.scrollTo({
      left: Math.max(0, left),
      behavior: scrollerRect.width > 0 && activeRect.width > 0 ? "smooth" : "auto",
    });
  }, [layout, playingPath, topTracks]);

  return (
    <div className={`music-dashboard${dashClass}`}>
      <section className="dash-row dash-row--tracks">
        <DashPaneLabel
          icon="repeat"
          title="ON REPEAT"
          subtitle="Most played tracks"
        />
        <div className="dash-scroll dash-scroll--tracks" ref={tracksScrollRef}>
          {topTracks.map((t) => {
            const cid = `track-${t.id}`;
            const title = (t.title_full ?? t.title ?? "")
              .replace(/\s*\[[^\]]*]/g, "")
              .trim();
            return (
              <DashMorphCard
                key={t.id}
                id={cid}
                title={title || "Track"}
                shape="square"
                coverUrl={t.cover_url}
                bannerUrl={t.banner_url}
                landscapeUrl={t.landscape_url}
                logoUrl={t.logo_url}
                logoCollapsedUrl={t.logo_collapsed_url}
                iconUrl={t.icon_url}
                titleOverBrand
                expanded={tracksExpand.expandedId === cid}
                revealed={revealedId === cid}
                active={Boolean(
                  isPlaying && playingPath && t.path === playingPath
                )}
                className="dash-track"
                preview={
                  t.path
                    ? {
                        requestKey: `track:${t.path}`,
                        load: () =>
                          fetchMusicDashPreview({
                            kind: "track",
                            path: t.path,
                          }),
                        playIconOnTitle: true,
                      }
                    : null
                }
                onEnter={tracksExpand.onEnter}
                onLeave={tracksExpand.onLeave}
                onActivate={onCardActivate(cid, () => {
                  if (t.path) onPlayTrack(t.path, t.artist_id, t.title);
                })}
              />
            );
          })}
          <PlaceholderTiles
            count={topTracks.length ? trackPlaceholders : paneLimit}
            variant="square"
          />
        </div>
      </section>

      <section className="dash-row dash-row--icons">
        <DashPaneLabel
          icon="star"
          title="BEST ARTISTS"
          subtitle="Your top artists"
        />
        <div className="dash-scroll dash-scroll--icons">
          {topArtists.map((a) => {
            const cid = `artist-${a.id}`;
            const preferPortrait = layout === "mobile-portrait";
            const cover =
              (preferPortrait
                ? a.portrait_url || a.photo_url
                : a.photo_url || a.portrait_url) || null;
            return (
              <DashMorphCard
                key={a.id}
                id={cid}
                title={(a.name ?? "Untitled").replace(/■/g, ",").replace(/█/g, "'")}
                shape="circle"
                coverUrl={cover}
                bannerUrl={a.banner_url}
                landscapeUrl={a.landscape_url}
                logoUrl={a.logo_url}
                logoCollapsedUrl={a.logo_collapsed_url}
                iconUrl={a.icon_url}
                expanded={artistsExpand.expandedId === cid}
                revealed={revealedId === cid}
                preview={{
                  requestKey: `artist:${a.id}`,
                  load: () =>
                    fetchMusicDashPreview({
                      kind: "artist",
                      artist_id: a.id,
                    }),
                  showMediaCaption: true,
                }}
                onEnter={artistsExpand.onEnter}
                onLeave={artistsExpand.onLeave}
                onActivate={onCardActivate(cid, () => onArtist(a.id))}
              />
            );
          })}
          <PlaceholderTiles
            count={topArtists.length ? artistPlaceholders : paneLimit}
            variant="icon-circle"
          />
        </div>
      </section>

      <section className="dash-row dash-row--tracks">
        <DashPaneLabel
          icon="disc"
          title="TOP RECORDS"
          subtitle="Most played releases"
        />
        <div className="dash-scroll dash-scroll--tracks">
          {topReleases.map((r) => {
            const cid = `release-${r.id}`;
            return (
              <DashMorphCard
                key={r.id}
                id={cid}
                title={r.title ?? ""}
                shape="square"
                coverUrl={r.cover_url}
                bannerUrl={r.banner_url}
                landscapeUrl={r.landscape_url}
                logoUrl={r.logo_url}
                logoCollapsedUrl={r.logo_collapsed_url}
                secondaryLogoUrl={r.artist_logo_url}
                secondaryLogoCollapsedUrl={r.artist_logo_collapsed_url}
                secondaryIconUrl={r.artist_icon_url}
                secondaryTitle={r.artist_name}
                expanded={releasesExpand.expandedId === cid}
                revealed={revealedId === cid}
                preview={{
                  requestKey: `release:${r.folder_path || r.id}`,
                  load: () =>
                    fetchMusicDashPreview({
                      kind: "release",
                      release_id: String(r.id),
                      folder_path: r.folder_path,
                    }),
                  showMediaCaption: true,
                }}
                onEnter={releasesExpand.onEnter}
                onLeave={releasesExpand.onLeave}
                onActivate={onCardActivate(cid, () => {
                  if (r.artist_id != null) {
                    onRelease(r.artist_id, r.id, {
                      artistName: r.artist_name,
                      title: r.title,
                    });
                  }
                })}
              />
            );
          })}
          <PlaceholderTiles
            count={topReleases.length ? releasePlaceholders : paneLimit}
            variant="square"
          />
        </div>
      </section>

      <section className="dash-row dash-row--genres">
        <DashPaneLabel
          icon="heart"
          title="MUSIC VIBES"
          subtitle="Genres on rotation"
        />
        <div className="dash-scroll dash-scroll--genres">
          {topGenres.map((g) => {
            const cid = `genre-${g.id ?? g.name}`;
            return (
              <DashMorphCard
                key={String(g.id ?? g.name)}
                id={cid}
                title={g.name}
                shape="circle"
                coverUrl={g.image_url}
                bannerUrl={g.image_url}
                landscapeUrl={g.image_url}
                logoUrl={g.logo_url}
                parentLine={
                  g.parent_genre &&
                  g.parent_genre.trim().toLowerCase() !==
                    (g.name || "").trim().toLowerCase()
                    ? g.parent_genre
                    : null
                }
                expanded={genresExpand.expandedId === cid}
                revealed={revealedId === cid}
                preview={{
                  requestKey: `genre:${g.id}`,
                  load: () =>
                    fetchMusicDashPreview({
                      kind: "genre",
                      genre_id: Number(g.id),
                    }),
                  showMediaCaption: true,
                  showPreviewArtist: true,
                }}
                onEnter={genresExpand.onEnter}
                onLeave={genresExpand.onLeave}
                onActivate={onCardActivate(cid, () => onGenre(Number(g.id)))}
              />
            );
          })}
          <PlaceholderTiles
            count={topGenres.length ? genrePlaceholders : paneLimit}
            variant="circle"
          />
        </div>
      </section>

      <section className="dash-row dash-row--flags">
        <DashPaneLabel
          icon="globe"
          title="ORIGINS"
          subtitle="Origins of your music"
        />
        <div className="dash-scroll dash-scroll--flags">
          {topCountries.map((c) => {
            const cid = `country-${c.name}`;
            return (
              <DashMorphCard
                key={c.name}
                id={cid}
                title={c.name}
                shape="flag"
                coverUrl={c.cover_url}
                bannerUrl={c.banner_url}
                landscapeUrl={c.landscape_url}
                flagIso={c.iso}
                expanded={countriesExpand.expandedId === cid}
                revealed={revealedId === cid}
                preview={{
                  requestKey: `country:${c.id ?? c.name}`,
                  load: () =>
                    fetchMusicDashPreview({
                      kind: "country",
                      country_id: c.id,
                      country_name: c.name,
                    }),
                  showMediaCaption: true,
                  showPreviewArtist: true,
                }}
                onEnter={countriesExpand.onEnter}
                onLeave={countriesExpand.onLeave}
                onActivate={onCardActivate(cid, () =>
                  onCountry({ id: c.id, name: c.name })
                )}
              />
            );
          })}
          <PlaceholderTiles
            count={topCountries.length ? countryPlaceholders : paneLimit}
            variant="flag"
          />
        </div>
      </section>
    </div>
  );
}
