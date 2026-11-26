import { useEffect, useLayoutEffect, useState } from "react";
import { fetchCatalogDashPreview } from "../../api";
import type { SeriesDashboard } from "../../types";
import { EMPTY_SERIES_DASHBOARD } from "../../types";
import { openCatalogVideo } from "../../openCatalogVideo";
import { usePlayVideosPreference } from "../../playVideosPreference";
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

type PlaceholderVariant = "square" | "landscape" | "portrait" | "circle" | "flag";

function DashPlaceholder({ variant }: { variant: PlaceholderVariant }) {
  const shape =
    variant === "square"
      ? "square"
      : variant === "circle"
        ? "circle"
        : variant === "flag"
          ? "flag"
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
  const baseLimit = paneItemLimit(layout);
  const hasUniverses = universes.length > 0;
  /** Portrait Best/Universes: +2 when Universes row exists. Origins stays at base. */
  const contentLimit = hasUniverses
    ? baseLimit + UNIVERSES_PANE_BONUS
    : baseLimit;
  const { playLocally } = usePlayVideosPreference();
  const { coarse, revealedId, onCardActivate } = useDashCardReveal();
  /** Touch / phone / tablet-portrait: square idle → landscape on tap. */
  const useSquareTiles =
    coarse ||
    layout === "mobile-portrait" ||
    layout === "mobile-landscape" ||
    layout === "tablet-portrait";
  const contentShape = (useSquareTiles ? "square" : "portrait") as const;

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

  const topFranchises = slicePane(dash.top_franchises || [], contentLimit);
  const topSeries = slicePane(dash.top_series, contentLimit);
  const topUniverses = slicePane(universes, contentLimit);
  const topGenres = slicePane(dash.top_genres, contentLimit);
  const topCountries = slicePane(dash.top_countries, contentLimit);

  const franchisePlaceholders = placeholderCount(
    topFranchises.length,
    contentLimit
  );
  const seriesPlaceholders = placeholderCount(topSeries.length, contentLimit);
  const universePlaceholders = placeholderCount(
    topUniverses.length,
    contentLimit
  );
  const genrePlaceholders = placeholderCount(topGenres.length, contentLimit);
  const countryPlaceholders = placeholderCount(
    topCountries.length,
    contentLimit
  );

  const dashClass = DASH_LAYOUT_CLASS[layout];
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
          icon="star"
          title="BEST SERIES"
          subtitle="Your top content"
        />
        <div className="dash-scroll dash-scroll--icons">
          {topSeries.map((s) => {
            const cid = `show-${s.id}`;
            const franchiseId = s.franchise_id || s.id;
            const openUrl =
              (s as { open_url?: string | null }).open_url || null;
            const openLabel =
              (s as { open_label?: string | null }).open_label ||
              (openUrl ? "Play episode 1" : null);
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
                actionLabel={openLabel}
                onAction={
                  openUrl
                    ? () => {
                        void openCatalogVideo({ openUrl, playLocally });
                      }
                    : undefined
                }
                expanded={seriesExpand.expandedId === cid}
                revealed={revealedId === cid}
                preview={{
                  requestKey: `series-show:${s.id}`,
                  load: () =>
                    fetchCatalogDashPreview({
                      module: "series",
                      kind: "show",
                      franchise_id: franchiseId,
                      subseries_id: s.subseries_id,
                      folder_path: (s as { folder_path?: string | null })
                        .folder_path,
                    }),
                  showMediaCaption: true,
                }}
                onEnter={seriesExpand.onEnter}
                onLeave={seriesExpand.onLeave}
                onActivate={onCardActivate(cid, () =>
                  onOpenShow(franchiseId, s.subseries_id)
                )}
              />
            );
          })}
          <PlaceholderTiles
            count={topSeries.length ? seriesPlaceholders : contentLimit}
            variant={contentShape}
          />
        </div>
      </section>

      <section className="dash-row dash-row--icons">
        <DashPaneLabel
          icon="saga"
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
                preview={{
                  requestKey: `series-franchise:${s.id}`,
                  load: () =>
                    fetchCatalogDashPreview({
                      module: "series",
                      kind: "franchise",
                      franchise_id: s.id,
                      folder_path: (s as { folder_path?: string | null })
                        .folder_path,
                    }),
                  showMediaCaption: true,
                  showPreviewArtist: true,
                }}
                onEnter={franchisesExpand.onEnter}
                onLeave={franchisesExpand.onLeave}
                onActivate={onCardActivate(cid, () => onOpenFranchise(s.id))}
              />
            );
          })}
          <PlaceholderTiles
            count={topFranchises.length ? franchisePlaceholders : contentLimit}
            variant={contentShape}
          />
        </div>
      </section>

      {topUniverses.length > 0 ? (
      <section className="dash-row dash-row--icons">
          <DashPaneLabel
            icon="planet"
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
                  preview={{
                    requestKey: `series-universe:${u.id}`,
                    load: () =>
                      fetchCatalogDashPreview({
                        module: "series",
                        kind: "universe",
                        universe_id: String(u.id),
                      }),
                    showMediaCaption: true,
                    showPreviewArtist: true,
                  }}
                  onEnter={universesExpand.onEnter}
                  onLeave={universesExpand.onLeave}
                  onActivate={onCardActivate(cid, () =>
                    onOpenUniverse?.(u.id)
                  )}
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
          icon="heart"
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
                preview={{
                  requestKey: `series-genre:${g.id ?? g.name}`,
                  load: () =>
                    fetchCatalogDashPreview({
                      module: "series",
                      kind: "genre",
                      genre_id: Number(g.id),
                    }),
                  showMediaCaption: true,
                  showPreviewArtist: true,
                }}
                onEnter={genresExpand.onEnter}
                onLeave={genresExpand.onLeave}
                onActivate={onCardActivate(cid, () => onGenre?.(g.id))}
              />
            );
          })}
          <PlaceholderTiles
            count={topGenres.length ? genrePlaceholders : contentLimit}
            variant="circle"
          />
        </div>
      </section>

      <section className="dash-row dash-row--flags">
        <DashPaneLabel
          icon="globe"
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
                shape="flag"
                flagIso={c.iso}
                expanded={countriesExpand.expandedId === cid}
                revealed={revealedId === cid}
                preview={{
                  requestKey: `series-country:${c.id ?? c.name}`,
                  load: () =>
                    fetchCatalogDashPreview({
                      module: "series",
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
                  onCountry?.({ id: c.id, name: c.name })
                )}
              />
            );
          })}
          <PlaceholderTiles
            count={topCountries.length ? countryPlaceholders : contentLimit}
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
