import { useEffect, useLayoutEffect, useState } from "react";
import type {
  MoviesFilmCard,
  SeriesDashboard,
  SeriesFranchiseCard,
  Universe,
} from "../../types";
import { EMPTY_SERIES_DASHBOARD } from "../../types";
import { playGameClient } from "../../gamesMobile";
import DashMorphCard from "../DashMorphCard";
import { useDashCardReveal } from "../DashHoverTitle";
import {
  prefetchDashArt,
  useDashPaneExpand,
} from "../useDashPaneExpand";

const PHONE_MAX_WIDTH = 900;
const PHONE_PORTRAIT_MAX_WIDTH = 480;
const TABLET_PORTRAIT_MAX_WIDTH = 1366;
const TABLET_LANDSCAPE_MAX_HEIGHT = 950;

function hasTouchScreen(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.maxTouchPoints > 0;
}

const DESKTOP_PANE_ITEMS = 13;
const DESKTOP_WIDE_PANE_ITEMS = 16;
const DESKTOP_WIDE_MIN_WIDTH = 1600;
const TABLET_LANDSCAPE_ITEMS = 8;
const TABLET_PORTRAIT_ITEMS = 6;
const MOBILE_LANDSCAPE_ITEMS = 6;
const MOBILE_PORTRAIT_ITEMS = 4;
/** Extra portrait tiles when Universes row is present (shorter panes). */
const UNIVERSES_PANE_BONUS = 2;

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

function useDashboardLayout(): DashLayout {
  const [layout, setLayout] = useState(resolveDashLayout);
  useLayoutEffect(() => {
    const update = () => setLayout(resolveDashLayout());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
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

type PlaceholderVariant = "landscape" | "portrait" | "square" | "circle";

function DashPlaceholder({ variant }: { variant: PlaceholderVariant }) {
  const shape =
    variant === "square"
      ? "square"
      : variant === "circle"
        ? "circle"
        : variant === "portrait"
          ? "portrait"
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

function DashPaneLabel({
  logo,
  title,
  subtitle,
}: {
  logo: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="dash-row-label">
      <img src={logo} alt="" className="dash-pane-logo" />
      <div className="dash-row-label-text">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}

type Props = {
  data: (SeriesDashboard & {
    platforms?: SeriesFranchiseCard[];
    recent_games?: MoviesFilmCard[];
    top_games?: MoviesFilmCard[];
  }) | null;
  loading?: boolean;
  universes?: Universe[];
  platforms?: SeriesFranchiseCard[];
  onPlatform?: (platformId: string, platformName?: string) => void;
  onFranchise: (workId: string) => void;
  onGame: (gameId: string, workId?: string) => void;
  onOpenUniverse?: (id: number) => void;
  onGenre?: (id: number | string) => void;
};

export default function GamesHome({
  data,
  loading,
  universes = [],
  platforms = [],
  onPlatform,
  onFranchise,
  onGame,
  onOpenUniverse,
  onGenre,
}: Props) {
  const dash = data ?? EMPTY_SERIES_DASHBOARD;
  const layout = useDashboardLayout();
  const baseLimit = paneItemLimit(layout);
  const hasUniverses = universes.length > 0;
  const contentLimit = hasUniverses
    ? baseLimit + UNIVERSES_PANE_BONUS
    : baseLimit;
  const { coarse, revealedId, onCardActivate } = useDashCardReveal();
  /** Touch / phone / tablet-portrait: square idle → landscape on tap. */
  const useSquareTiles =
    coarse ||
    layout === "mobile-portrait" ||
    layout === "mobile-landscape" ||
    layout === "tablet-portrait";
  const contentShape = (useSquareTiles ? "square" : "portrait") as const;
  const franchisesExpand = useDashPaneExpand(revealedId, coarse);
  const gamesExpand = useDashPaneExpand(revealedId, coarse);
  const universesExpand = useDashPaneExpand(revealedId, coarse);
  const genresExpand = useDashPaneExpand(revealedId, coarse);
  const platformsExpand = useDashPaneExpand(revealedId, coarse);

  const pickCover = (s: {
    portrait_url?: string | null;
    cover_url?: string | null;
    photo_url?: string | null;
    banner_url?: string | null;
    landscape_url?: string | null;
  }) =>
    useSquareTiles
      ? s.cover_url ||
        s.photo_url ||
        s.portrait_url ||
        s.landscape_url ||
        s.banner_url ||
        null
      : s.portrait_url ||
        s.cover_url ||
        s.photo_url ||
        s.landscape_url ||
        s.banner_url ||
        null;

  const platformRow =
    platforms.length > 0 ? platforms : data?.platforms || [];
  const topFranchises = slicePane(dash.top_franchises || [], contentLimit);
  const topGames = slicePane(
    (data?.top_games ||
      (dash as { top_series?: MoviesFilmCard[] }).top_series ||
      []) as MoviesFilmCard[],
    contentLimit
  );
  const topUniverses = slicePane(universes, contentLimit);
  const topGenres = slicePane(dash.top_genres || [], baseLimit);

  const franchisePlaceholders = placeholderCount(
    topFranchises.length,
    contentLimit
  );
  const gamePlaceholders = placeholderCount(topGames.length, contentLimit);
  const universePlaceholders = placeholderCount(
    topUniverses.length,
    contentLimit
  );
  const genrePlaceholders = placeholderCount(topGenres.length, baseLimit);

  const dashClass = DASH_LAYOUT_CLASS[layout];

  useEffect(() => {
    prefetchDashArt([
      ...topFranchises.flatMap((s) => [
        s.banner_url,
        s.landscape_url,
        pickCover(s),
        s.logo_url,
        s.icon_url,
      ]),
      ...topGames.flatMap((g) => [
        g.banner_url,
        g.landscape_url,
        pickCover(g),
        g.logo_url,
        g.icon_url,
      ]),
      ...topUniverses.flatMap((u) => [
        u.banner_url,
        u.landscape_url,
        pickCover(u),
        u.logo_url,
      ]),
      ...topGenres.map((g) => g.image_url),
      ...platformRow.flatMap((p) => [
        p.banner_url,
        p.landscape_url,
        p.cover_url,
        p.logo_url,
        p.icon_url,
      ]),
    ]);
  }, [
    topFranchises,
    topGames,
    topUniverses,
    topGenres,
    platformRow,
  ]);

  return (
    <div
      className={`music-dashboard series-dashboard games-dashboard${dashClass}${
        loading ? "" : " dash-appear-ready"
      }`}
    >
      <section className="dash-row dash-row--icons">
        <DashPaneLabel
          logo="/api/assets/icons/pane-sagas"
          title="BEST SAGAS"
          subtitle="Your top franchises"
        />
        <div className="dash-scroll dash-scroll--icons">
          {topFranchises.map((s) => {
            const cid = `franchise-${s.id}`;
            return (
              <DashMorphCard
                key={s.id}
                id={cid}
                title={s.name}
                shape={contentShape}
                coverUrl={pickCover(s)}
                bannerUrl={s.banner_url}
                landscapeUrl={s.landscape_url}
                logoUrl={s.logo_url}
                logoCollapsedUrl={
                  (s as { logo_collapsed_url?: string | null }).logo_collapsed_url
                }
                iconUrl={s.icon_url}
                expanded={franchisesExpand.expandedId === cid}
                revealed={revealedId === cid}
                onEnter={franchisesExpand.onEnter}
                onLeave={franchisesExpand.onLeave}
                onActivate={onCardActivate(cid, () => onFranchise(s.id))}
              />
            );
          })}
          <PlaceholderTiles
            count={topFranchises.length ? franchisePlaceholders : contentLimit}
            variant={contentShape}
          />
        </div>
      </section>

      <section className="dash-row dash-row--icons">
        <DashPaneLabel
          logo="/api/assets/icons/pane-best"
          title="BEST GAMES"
          subtitle="Your top video games"
        />
        <div className="dash-scroll dash-scroll--icons">
          {topGames.map((g) => {
            const cid = `game-${g.id}`;
            const canPlay = Boolean(
              (g as { has_rom?: boolean }).has_rom || g.open_url
            );
            return (
              <DashMorphCard
                key={g.id}
                id={cid}
                title={g.title}
                shape={contentShape}
                coverUrl={pickCover(g)}
                bannerUrl={g.banner_url}
                landscapeUrl={g.landscape_url}
                logoUrl={g.logo_url}
                logoCollapsedUrl={
                  (g as { logo_collapsed_url?: string | null }).logo_collapsed_url
                }
                iconUrl={g.icon_url}
                actionLabel={canPlay ? "Play game" : null}
                onAction={
                  canPlay
                    ? () => {
                        void playGameClient({
                          gameId: g.id,
                          openMode: g.open_mode,
                          openUrl: g.open_url,
                          romBytes: (g as { rom_bytes?: number | null })
                            .rom_bytes,
                          romFilename: (g as { rom_filename?: string | null })
                            .rom_filename,
                          title: g.title,
                        }).catch(() => undefined);
                      }
                    : undefined
                }
                expanded={gamesExpand.expandedId === cid}
                revealed={revealedId === cid}
                onEnter={gamesExpand.onEnter}
                onLeave={gamesExpand.onLeave}
                onActivate={onCardActivate(cid, () =>
                  onGame(g.id, g.work_id)
                )}
              />
            );
          })}
          <PlaceholderTiles
            count={topGames.length ? gamePlaceholders : contentLimit}
            variant={contentShape}
          />
        </div>
      </section>

      {topUniverses.length > 0 && onOpenUniverse ? (
        <section className="dash-row dash-row--icons">
          <DashPaneLabel
            logo="/api/assets/icons/pane-universes"
            title="UNIVERSES"
            subtitle="Shared story worlds"
          />
          <div className="dash-scroll dash-scroll--icons">
            {topUniverses.map((u) => {
              const cid = `universe-${u.id}`;
              return (
                <DashMorphCard
                  key={u.id}
                  id={cid}
                  title={u.name}
                  shape={contentShape}
                  coverUrl={pickCover(u)}
                  bannerUrl={u.banner_url}
                  landscapeUrl={u.landscape_url}
                  logoUrl={u.logo_url}
                  logoCollapsedUrl={
                    (u as { logo_collapsed_url?: string | null })
                      .logo_collapsed_url
                  }
                  expanded={universesExpand.expandedId === cid}
                  revealed={revealedId === cid}
                  onEnter={universesExpand.onEnter}
                  onLeave={universesExpand.onLeave}
                  onActivate={onCardActivate(cid, () => onOpenUniverse(u.id))}
                />
              );
            })}
            <PlaceholderTiles
              count={topUniverses.length ? universePlaceholders : contentLimit}
              variant={contentShape}
            />
          </div>
        </section>
      ) : null}

      <section className="dash-row dash-row--genres">
        <DashPaneLabel
          logo="/api/assets/icons/pane-vibes"
          title="GAME VIBES"
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
                expanded={genresExpand.expandedId === cid}
                revealed={revealedId === cid}
                onEnter={genresExpand.onEnter}
                onLeave={genresExpand.onLeave}
                onActivate={onCardActivate(cid, () => onGenre?.(g.id))}
              />
            );
          })}
          <PlaceholderTiles
            count={topGenres.length ? genrePlaceholders : baseLimit}
            variant="circle"
          />
        </div>
      </section>

      <section className="dash-row dash-row--tracks dash-row--platforms">
        <DashPaneLabel
          logo="/api/assets/icons/pane-consoles"
          title="CONSOLES"
          subtitle="Your games per platform"
        />
        <div className="dash-scroll dash-scroll--tracks dash-scroll--platforms">
          {platformRow.map((p) => {
            const cid = `platform-${p.id}`;
            const cover =
              p.cover_url || "/api/assets/platforms/default.png";
            return (
              <DashMorphCard
                key={p.id}
                id={cid}
                title={p.name}
                shape="square"
                coverUrl={cover}
                bannerUrl={p.banner_url}
                landscapeUrl={p.landscape_url}
                logoUrl={p.logo_url}
                iconUrl={p.icon_url}
                expanded={platformsExpand.expandedId === cid}
                revealed={revealedId === cid}
                className="dash-track dash-platform"
                onEnter={platformsExpand.onEnter}
                onLeave={platformsExpand.onLeave}
                onActivate={onCardActivate(cid, () =>
                  onPlatform?.(p.id, p.name)
                )}
              />
            );
          })}
          {!platformRow.length ? (
            <PlaceholderTiles count={baseLimit} variant="square" />
          ) : null}
        </div>
      </section>

      {!loading &&
      !platformRow.length &&
      !topFranchises.length &&
      !topGames.length ? (
        <p className="muted module-placeholder">
          No games found under Games/ — add platform folders to get started.
        </p>
      ) : null}
    </div>
  );
}
