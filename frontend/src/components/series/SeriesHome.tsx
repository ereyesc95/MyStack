import { useEffect, useLayoutEffect, useState } from "react";
import type { SeriesDashboard } from "../../types";
import { EMPTY_SERIES_DASHBOARD } from "../../types";
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

const DESKTOP_PANE_ITEMS = 11;
const TABLET_LANDSCAPE_ITEMS = 8;
const TABLET_PORTRAIT_ITEMS = 6;
const MOBILE_LANDSCAPE_ITEMS = 6;
const MOBILE_PORTRAIT_ITEMS = 4;

type DashLayout =
  | "desktop"
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
    return "desktop";
  }

  if (width <= PHONE_PORTRAIT_MAX_WIDTH) return "mobile-portrait";
  if (width <= TABLET_PORTRAIT_MAX_WIDTH) return "tablet-portrait";
  return "desktop";
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
    default:
      return DESKTOP_PANE_ITEMS;
  }
}

const DASH_LAYOUT_CLASS: Record<DashLayout, string> = {
  desktop: "",
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

type PlaceholderVariant = "square" | "landscape" | "circle" | "flag";

function DashPlaceholder({ variant }: { variant: PlaceholderVariant }) {
  if (variant === "landscape") {
    return (
      <div className="dash-icon-item dash-placeholder-item" aria-hidden>
        <span className="dash-icon-item-cover dash-placeholder dash-placeholder--landscape" />
      </div>
    );
  }
  if (variant === "square") {
    return (
      <div className="dash-track dash-placeholder-item" aria-hidden>
        <span className="dash-track-art dash-placeholder dash-placeholder--square" />
      </div>
    );
  }
  if (variant === "circle") {
    return (
      <div className="dash-genre dash-placeholder-item" aria-hidden>
        <span className="dash-genre-ring dash-placeholder dash-placeholder--circle" />
      </div>
    );
  }
  return (
    <div className="dash-country dash-placeholder-item" aria-hidden>
      <span className="dash-country-flag dash-placeholder dash-placeholder--flag" />
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
  data: SeriesDashboard | null;
  loading?: boolean;
  universes?: import("../../types").Universe[];
  onOpenShow: (franchiseId: string, subseriesId?: string | null) => void;
  onOpenFranchise: (franchiseId: string) => void;
  onOpenUniverse?: (universeId: number) => void;
  onGenre?: (id: number | string) => void;
  onCountry?: (country: { id?: number; name: string }) => void;
};

export default function SeriesHome({
  data,
  loading,
  universes = [],
  onOpenShow,
  onOpenFranchise,
  onOpenUniverse,
  onGenre,
  onCountry,
}: Props) {
  const dash = data ?? EMPTY_SERIES_DASHBOARD;
  const layout = useDashboardLayout();
  const paneLimit = paneItemLimit(layout);
  const useBannerArt = layout === "mobile-landscape";
  const contentShape = useBannerArt ? "landscape" : "portrait";

  const pickCover = (s: {
    portrait_url?: string | null;
    cover_url?: string | null;
    photo_url?: string | null;
    banner_url?: string | null;
    landscape_url?: string | null;
  }) => {
    if (useBannerArt) {
      return (
        s.banner_url ||
        s.landscape_url ||
        s.portrait_url ||
        s.cover_url ||
        s.photo_url ||
        null
      );
    }
    return s.portrait_url || s.cover_url || s.photo_url || null;
  };

  const topFranchises = slicePane(dash.top_franchises || [], paneLimit);
  const topSeries = slicePane(dash.top_series, paneLimit);
  const topUniverses = slicePane(universes, paneLimit);
  const topGenres = slicePane(dash.top_genres, paneLimit);
  const topCountries = slicePane(dash.top_countries, paneLimit);

  const franchisePlaceholders = placeholderCount(topFranchises.length, paneLimit);
  const seriesPlaceholders = placeholderCount(topSeries.length, paneLimit);
  const universePlaceholders = placeholderCount(topUniverses.length, paneLimit);
  const genrePlaceholders = placeholderCount(topGenres.length, paneLimit);
  const countryPlaceholders = placeholderCount(topCountries.length, paneLimit);

  const dashClass = DASH_LAYOUT_CLASS[layout];
  const { coarse, revealedId, onCardActivate } = useDashCardReveal();
  const franchisesExpand = useDashPaneExpand(revealedId, coarse);
  const seriesExpand = useDashPaneExpand(revealedId, coarse);
  const universesExpand = useDashPaneExpand(revealedId, coarse);
  const genresExpand = useDashPaneExpand(revealedId, coarse);
  const countriesExpand = useDashPaneExpand(revealedId, coarse);

  useEffect(() => {
    prefetchDashArt([
      ...topFranchises.flatMap((s) => [
        s.banner_url,
        s.landscape_url,
        pickCover(s),
        s.logo_url,
        s.icon_url,
      ]),
      ...topSeries.flatMap((s) => [
        s.banner_url,
        s.landscape_url,
        pickCover(s),
        s.logo_url,
        s.icon_url,
      ]),
      ...topUniverses.flatMap((u) => [
        u.banner_url,
        u.landscape_url,
        pickCover(u),
        u.logo_url,
      ]),
      ...topGenres.map((g) => g.image_url),
    ]);
  }, [topFranchises, topSeries, topUniverses, topGenres, topCountries]);

  return (
    <div
      className={`music-dashboard series-dashboard${dashClass}${
        loading ? "" : " dash-appear-ready"
      }`}
    >
      <>
      <section className="dash-row dash-row--icons">
        <DashPaneLabel
          logo="/api/assets/icons/pane-best"
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
                iconUrl={s.icon_url}
                expanded={franchisesExpand.expandedId === cid}
                revealed={revealedId === cid}
                onEnter={franchisesExpand.onEnter}
                onLeave={franchisesExpand.onLeave}
                onActivate={onCardActivate(cid, () => onOpenFranchise(s.id))}
              />
            );
          })}
          <PlaceholderTiles
            count={topFranchises.length ? franchisePlaceholders : paneLimit}
            variant="landscape"
          />
        </div>
      </section>

      <section className="dash-row dash-row--icons">
        <DashPaneLabel
          logo="/api/assets/icons/pane-best"
          title="BEST SERIES"
          subtitle="Your top content"
        />
        <div className="dash-scroll dash-scroll--icons">
          {topSeries.map((s) => {
            const cid = `show-${s.id}`;
            const franchiseId = s.franchise_id || s.id;
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
                iconUrl={s.icon_url}
                expanded={seriesExpand.expandedId === cid}
                revealed={revealedId === cid}
                onEnter={seriesExpand.onEnter}
                onLeave={seriesExpand.onLeave}
                onActivate={onCardActivate(cid, () =>
                  onOpenShow(franchiseId, s.subseries_id)
                )}
              />
            );
          })}
          <PlaceholderTiles
            count={topSeries.length ? seriesPlaceholders : paneLimit}
            variant="landscape"
          />
        </div>
      </section>

      {topUniverses.length > 0 ? (
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
                  expanded={universesExpand.expandedId === cid}
                  revealed={revealedId === cid}
                  onEnter={universesExpand.onEnter}
                  onLeave={universesExpand.onLeave}
                  onActivate={onCardActivate(cid, () =>
                    onOpenUniverse?.(u.id)
                  )}
                />
              );
            })}
            <PlaceholderTiles
              count={topUniverses.length ? universePlaceholders : paneLimit}
              variant="landscape"
            />
          </div>
        </section>
      ) : null}

      <section className="dash-row dash-row--genres">
        <DashPaneLabel
          logo="/api/assets/icons/pane-vibes"
          title="SHOW VIBES"
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
            count={topGenres.length ? genrePlaceholders : paneLimit}
            variant="circle"
          />
        </div>
      </section>

      <section className="dash-row dash-row--flags">
        <DashPaneLabel
          logo="/api/assets/icons/pane-origins"
          title="ORIGINS"
          subtitle="Origins of your content"
        />
        <div className="dash-scroll dash-scroll--flags">
          {topCountries.map((c) => {
            const cid = `country-${c.name}`;
            return (
              <DashMorphCard
                key={c.name}
                id={cid}
                title={c.name}
                shape="landscape"
                flagIso={c.iso}
                expanded={countriesExpand.expandedId === cid}
                revealed={revealedId === cid}
                onEnter={countriesExpand.onEnter}
                onLeave={countriesExpand.onLeave}
                onActivate={onCardActivate(cid, () =>
                  onCountry?.({ id: c.id, name: c.name })
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
      </>
      {!loading &&
      !topFranchises.length &&
      !topSeries.length ? (
        <p className="muted module-placeholder">
          No series found under Series/ — add show folders to get started.
        </p>
      ) : null}
    </div>
  );
}
