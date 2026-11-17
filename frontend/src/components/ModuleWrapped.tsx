import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchModuleWrapped } from "../api";
import {
  getCachedModuleWrapped,
  setCachedModuleWrapped,
} from "../moduleWrappedCache";
import type { ModuleWrapped, ModuleWrappedItem, ModuleWrappedKind } from "../types";
import ModalPortal, { useModalClose } from "./ModalPortal";

type TabId = "items" | "groups" | "vibes";

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
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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
}: Props) {
  const cached = getCachedModuleWrapped(module, year);
  const [data, setData] = useState<ModuleWrapped | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("items");
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyShellRef = useRef<HTMLDivElement>(null);
  const bodyContentRef = useRef<HTMLDivElement>(null);
  const heightReadyRef = useRef(false);
  const pinnedTopRef = useRef<number | null>(null);
  const requestClose = useModalClose(onClose);

  useEffect(() => {
    let cancelled = false;
    const hit = getCachedModuleWrapped(module, year);
    if (hit) {
      setData(hit);
      setLoading(false);
      setError(null);
      return;
    }
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

  const items = useMemo(
    () => (data?.top_items || []).slice(0, 100),
    [data]
  );
  const groups = useMemo(
    () => (data?.top_groups || []).slice(0, 15),
    [data]
  );
  const vibes = useMemo(
    () => (data?.top_vibes || []).slice(0, 40),
    [data]
  );
  const countLabel = data?.count_label || "plays";

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
    groups.length,
    vibes.length,
  ]);

  const featuredItem = items[0];
  const restItems = items.slice(1);
  const featuredGroup = groups[0];
  const restGroups = groups.slice(1);
  const featuredVibe = vibes[0];
  const restVibes = vibes.slice(1);

  const tabDefs: [TabId, string][] = [
    ["items", data?.items_tab || "On repeat"],
    ["groups", data?.groups_tab || "Top"],
    ["vibes", data?.vibes_tab || "Vibes"],
  ];

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

          <div className="music-wrapped__body-shell" ref={bodyShellRef}>
            <div
              className="music-wrapped__body"
              ref={bodyContentRef}
              key={tab}
            >
              {tab === "items" ? (
                <div className="music-wrapped__pane music-wrapped__pane--tracks">
                  <div className="music-wrapped__pane-scroll">
                    {items.length === 0 ? (
                      <p className="muted music-wrapped__status">
                        Nothing yet.
                      </p>
                    ) : (
                      <>
                        {featuredItem ? (
                          <button
                            type="button"
                            className="music-wrapped__feature music-wrapped__feature--track"
                            onClick={() => onOpenItem?.(featuredItem)}
                          >
                            {featuredItem.cover_url ? (
                              <img
                                className="music-wrapped__feature-art music-wrapped__feature-art--square"
                                src={featuredItem.cover_url}
                                alt=""
                              />
                            ) : (
                              <span className="music-wrapped__feature-art music-wrapped__feature-art--square music-wrapped__art-fallback" />
                            )}
                            <span className="music-wrapped__feature-meta">
                              <span className="music-wrapped__feature-rank">
                                {data.items_rank}
                              </span>
                              <strong>{featuredItem.title}</strong>
                              <em>
                                {featuredItem.subtitle}
                                {featuredItem.play_count != null
                                  ? `${featuredItem.subtitle ? " · " : ""}${featuredItem.play_count.toLocaleString()} ${countLabel}`
                                  : ""}
                              </em>
                            </span>
                          </button>
                        ) : null}
                        <ol className="music-wrapped__list">
                          {restItems.map((t, i) => {
                            const rank = i + 2;
                            const slim = rank > 10;
                            return (
                              <li key={t.id || t.path || rank}>
                                <button
                                  type="button"
                                  className={`music-wrapped__row${
                                    slim ? " music-wrapped__row--slim" : ""
                                  }`}
                                  onClick={() => onOpenItem?.(t)}
                                >
                                  {!slim ? (
                                    t.cover_url ? (
                                      <img src={t.cover_url} alt="" />
                                    ) : (
                                      <span className="music-wrapped__art-fallback" />
                                    )
                                  ) : (
                                    <span className="music-wrapped__rank">
                                      {rank}
                                    </span>
                                  )}
                                  <span>
                                    <strong>{t.title}</strong>
                                    <em>{t.subtitle}</em>
                                  </span>
                                  <span className="music-wrapped__count">
                                    {t.play_count.toLocaleString()} {countLabel}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      </>
                    )}
                  </div>
                  {data.browse_top ? (
                    <div className="music-wrapped__playlist-bar">
                      <button
                        type="button"
                        className="btn music-wrapped__playlist-btn"
                        onClick={() => {
                          const top = data.browse_top!;
                          requestClose(() =>
                            onBrowseTop?.({
                              module,
                              id: top.id,
                              title: top.title,
                              franchiseId: top.franchise_id,
                              groupId: top.group_id,
                            })
                          );
                        }}
                      >
                        {data.browse_label}
                        {data.browse_top.title
                          ? ` · ${data.browse_top.title}`
                          : ""}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === "groups" ? (
                <div className="music-wrapped__pane">
                  {groups.length === 0 ? (
                    <p className="muted music-wrapped__status">Nothing yet.</p>
                  ) : (
                    <>
                      {featuredGroup ? (
                        <button
                          type="button"
                          className="music-wrapped__feature"
                          onClick={() => browseFromGroup(featuredGroup)}
                        >
                          {featuredGroup.cover_url || featuredGroup.photo_url ? (
                            <img
                              className="music-wrapped__feature-art"
                              src={
                                featuredGroup.cover_url ||
                                featuredGroup.photo_url ||
                                ""
                              }
                              alt=""
                            />
                          ) : (
                            <span className="music-wrapped__feature-art music-wrapped__art-fallback" />
                          )}
                          <span className="music-wrapped__feature-meta">
                            <span className="music-wrapped__feature-rank">
                              {data.groups_rank}
                            </span>
                            <strong>{featuredGroup.title}</strong>
                            <em>
                              {featuredGroup.play_count} {countLabel}
                            </em>
                          </span>
                        </button>
                      ) : null}
                      {restGroups.length > 0 ? (
                        <ul className="music-wrapped__grid">
                          {restGroups.map((a, i) => (
                            <li key={a.id}>
                              <button
                                type="button"
                                className="music-wrapped__grid-card"
                                onClick={() => browseFromGroup(a)}
                              >
                                {a.cover_url || a.photo_url ? (
                                  <img
                                    src={a.cover_url || a.photo_url || ""}
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
                                    {a.title}
                                  </strong>
                                  <em>
                                    {a.play_count} {countLabel}
                                  </em>
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
                  {vibes.length === 0 ? (
                    <p className="muted music-wrapped__status">Nothing yet.</p>
                  ) : (
                    <>
                      {featuredVibe ? (
                        <button
                          type="button"
                          className="music-wrapped__feature"
                          onClick={() => {
                            if (module === "files" || module === "hobbies") {
                              onOpenItem?.(featuredVibe);
                            } else {
                              requestClose(() => onOpenVibe?.(featuredVibe));
                            }
                          }}
                        >
                          {featuredVibe.image_url || featuredVibe.cover_url ? (
                            featuredVibe.image_url && !featuredVibe.cover_url ? (
                              <span
                                className="music-wrapped__feature-art music-wrapped__feature-art--genre"
                                style={{
                                  backgroundImage: `url("${featuredVibe.image_url}")`,
                                }}
                              />
                            ) : (
                              <img
                                className="music-wrapped__feature-art music-wrapped__feature-art--square"
                                src={
                                  featuredVibe.cover_url ||
                                  featuredVibe.image_url ||
                                  ""
                                }
                                alt=""
                              />
                            )
                          ) : (
                            <span className="music-wrapped__feature-art music-wrapped__art-fallback" />
                          )}
                          <span className="music-wrapped__feature-meta">
                            <span className="music-wrapped__feature-rank">
                              {module === "files" || module === "hobbies"
                                ? "#1 Only once"
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
                        <ul className="music-wrapped__grid">
                          {restVibes.map((g, i) => (
                            <li key={String(g.id)}>
                              <button
                                type="button"
                                className="music-wrapped__grid-card"
                                onClick={() => {
                                  if (
                                    module === "files" ||
                                    module === "hobbies"
                                  ) {
                                    onOpenItem?.(g);
                                  } else {
                                    requestClose(() => onOpenVibe?.(g));
                                  }
                                }}
                              >
                                {g.image_url && !g.cover_url ? (
                                  <span
                                    className="music-wrapped__grid-genre"
                                    style={{
                                      backgroundImage: `url("${g.image_url}")`,
                                    }}
                                  />
                                ) : g.cover_url || g.photo_url ? (
                                  <img
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
