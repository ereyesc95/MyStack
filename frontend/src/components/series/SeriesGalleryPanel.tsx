import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSeriesGallery } from "../../api";
import { withMediaAccess } from "../../mediaFileUrl";
import type {
  SeriesGalleryItem,
  SeriesGalleryPerson,
  SeriesGallerySection,
  SeriesGallerySubsection,
} from "../../types";
import PlaylistBoot from "../PlaylistBoot";
import { IconExternalLink } from "../MenuIcons";
import GalleryViewerModal, {
  type GalleryViewerItem,
} from "../music/artist/GalleryViewerModal";

type SectionMeta = { key: string; label: string };

type Props = {
  /** Single folder (legacy). Ignored when folderPaths is set. */
  folderPath?: string;
  /** Merge gallery images from multiple folders (franchise All = root + subseries). */
  folderPaths?: string[];
  /** Prebuilt items (e.g. universe assets) — skips folder fetch when set. */
  presetItems?: SeriesGalleryItem[];
  sectionKey?: string;
  onSectionKeyChange?: (key: string) => void;
  onSectionsChange?: (sections: SectionMeta[], hasMultiple: boolean) => void;
  personKey?: string;
  onPersonKeyChange?: (key: string) => void;
  onPeopleChange?: (people: SectionMeta[]) => void;
  subsectionKey?: string;
  onSubsectionKeyChange?: (key: string) => void;
  onSubsectionsChange?: (sections: SectionMeta[]) => void;
  hideSubbar?: boolean;
};

function mergePeople(
  a: SeriesGalleryPerson[] | undefined,
  b: SeriesGalleryPerson[] | undefined,
  seenIds: Set<string>
): SeriesGalleryPerson[] | undefined {
  if (!a?.length && !b?.length) return undefined;
  const byKey = new Map<string, SeriesGalleryPerson>();
  for (const src of [a || [], b || []]) {
    for (const person of src) {
      const freshItems = (person.items || []).filter((it) => {
        if (seenIds.has(it.id)) return false;
        seenIds.add(it.id);
        return true;
      });
      const freshSubs = (person.subsections || []).map((sub) => ({
        ...sub,
        items: sub.items.filter((it) => {
          if (seenIds.has(it.id)) return false;
          seenIds.add(it.id);
          return true;
        }),
      }));
      const existing = byKey.get(person.key);
      if (existing) {
        existing.items = [...existing.items, ...freshItems];
        if (freshSubs.length) {
          const subsByKey = new Map(
            (existing.subsections || []).map((s) => [s.key, s])
          );
          for (const sub of freshSubs) {
            const prev = subsByKey.get(sub.key);
            if (prev) prev.items = [...prev.items, ...sub.items];
            else subsByKey.set(sub.key, sub);
          }
          existing.subsections = [...subsByKey.values()];
        }
      } else {
        byKey.set(person.key, {
          ...person,
          items: [...freshItems],
          subsections: freshSubs.length ? freshSubs : person.subsections,
        });
      }
    }
  }
  return [...byKey.values()];
}

function mergeSections(
  batches: SeriesGallerySection[][]
): { sections: SeriesGallerySection[]; items: SeriesGalleryItem[] } {
  const byKey = new Map<string, SeriesGallerySection>();
  const seenIds = new Set<string>();
  const items: SeriesGalleryItem[] = [];
  for (const secs of batches) {
    for (const sec of secs) {
      const existing = byKey.get(sec.key);
      const freshItems = (sec.items || []).filter((it) => {
        if (seenIds.has(it.id)) return false;
        seenIds.add(it.id);
        return true;
      });
      const freshSubs = (sec.subsections || []).map((sub) => ({
        ...sub,
        items: sub.items.filter((it) => {
          if (seenIds.has(it.id)) return false;
          seenIds.add(it.id);
          return true;
        }),
      }));
      const people = mergePeople(undefined, sec.people, seenIds);
      if (existing) {
        existing.items = [...existing.items, ...freshItems];
        if (freshSubs.length) {
          const subsByKey = new Map(
            (existing.subsections || []).map((s) => [s.key, s])
          );
          for (const sub of freshSubs) {
            const prev = subsByKey.get(sub.key);
            if (prev) prev.items = [...prev.items, ...sub.items];
            else subsByKey.set(sub.key, sub);
          }
          existing.subsections = [...subsByKey.values()];
        }
        const mergedPeople = mergePeople(existing.people, people, seenIds);
        if (mergedPeople?.length) existing.people = mergedPeople;
      } else {
        byKey.set(sec.key, {
          ...sec,
          items: [...freshItems],
          subsections: freshSubs.length ? freshSubs : sec.subsections,
          people: people?.length ? people : sec.people,
        });
      }
      items.push(...freshItems);
      for (const sub of freshSubs) items.push(...sub.items);
      for (const person of people || sec.people || []) {
        items.push(...(person.items || []));
        for (const sub of person.subsections || []) items.push(...sub.items);
      }
    }
  }
  return { sections: [...byKey.values()], items };
}

function isGalleryLinkItem(item: SeriesGalleryItem): boolean {
  return item.media_kind === "link" || Boolean(item.is_external_link);
}

function mediaKind(item: SeriesGalleryItem): "image" | "video" | "audio" {
  if (item.media_kind === "video") return "video";
  if (item.media_kind === "audio") return "audio";
  return "image";
}

function activeSubsections(
  sec: SeriesGallerySection | undefined
): SeriesGallerySubsection[] {
  return sec?.subsections?.filter((s) => s.items.length > 0) ?? [];
}

export default function SeriesGalleryPanel({
  folderPath,
  folderPaths,
  presetItems,
  sectionKey: controlledKey,
  onSectionKeyChange,
  onSectionsChange,
  personKey: controlledPersonKey,
  onPersonKeyChange,
  onPeopleChange,
  subsectionKey: controlledSubKey,
  onSubsectionKeyChange,
  onSubsectionsChange,
  hideSubbar = false,
}: Props) {
  const [sections, setSections] = useState<SeriesGallerySection[]>([]);
  const [items, setItems] = useState<SeriesGalleryItem[]>([]);
  const [internalKey, setInternalKey] = useState<string>("");
  const [internalPersonKey, setInternalPersonKey] = useState<string>("");
  const [internalSubKey, setInternalSubKey] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const onSectionsChangeRef = useRef(onSectionsChange);
  const onSectionKeyChangeRef = useRef(onSectionKeyChange);
  const onPeopleChangeRef = useRef(onPeopleChange);
  const onPersonKeyChangeRef = useRef(onPersonKeyChange);
  const onSubsectionsChangeRef = useRef(onSubsectionsChange);
  const onSubsectionKeyChangeRef = useRef(onSubsectionKeyChange);
  onSectionsChangeRef.current = onSectionsChange;
  onSectionKeyChangeRef.current = onSectionKeyChange;
  onPeopleChangeRef.current = onPeopleChange;
  onPersonKeyChangeRef.current = onPersonKeyChange;
  onSubsectionsChangeRef.current = onSubsectionsChange;
  onSubsectionKeyChangeRef.current = onSubsectionKeyChange;

  const pathsKey = useMemo(() => {
    const paths =
      folderPaths && folderPaths.length
        ? folderPaths.filter(Boolean)
        : folderPath
          ? [folderPath]
          : [];
    return paths.join("|");
  }, [folderPath, folderPaths]);

  const presetKey = useMemo(
    () => (presetItems || []).map((it) => it.id).join("|"),
    [presetItems]
  );

  const sectionKey = controlledKey ?? internalKey;
  const setSectionKey = (key: string) => {
    if (onSectionKeyChangeRef.current) onSectionKeyChangeRef.current(key);
    else setInternalKey(key);
  };
  const personKey = controlledPersonKey ?? internalPersonKey;
  const setPersonKey = (key: string) => {
    if (onPersonKeyChangeRef.current) onPersonKeyChangeRef.current(key);
    else setInternalPersonKey(key);
  };
  const subsectionKey = controlledSubKey ?? internalSubKey;
  const setSubsectionKey = (key: string) => {
    if (onSubsectionKeyChangeRef.current) onSubsectionKeyChangeRef.current(key);
    else setInternalSubKey(key);
  };

  const load = useCallback(async () => {
    if (presetItems && presetItems.length) {
      const sec: SeriesGallerySection = {
        key: "art",
        label: "Art",
        items: presetItems,
      };
      setSections([sec]);
      setItems(presetItems);
      setLoading(false);
      setError(null);
      onSectionsChangeRef.current?.(
        [{ key: "art", label: "Art" }],
        false
      );
      return;
    }
    const paths = pathsKey ? pathsKey.split("|").filter(Boolean) : [];
    if (!paths.length) {
      setSections([]);
      setItems([]);
      setLoading(false);
      onSectionsChangeRef.current?.([], false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        paths.map((p) => fetchSeriesGallery(p).catch(() => null))
      );
      const batches: SeriesGallerySection[][] = [];
      for (const data of results) {
        if (!data) continue;
        const secs = data.sections?.length
          ? data.sections
          : data.items.length
            ? [{ key: "covers", label: "Covers", items: data.items }]
            : [];
        if (secs.length) batches.push(secs);
      }
      const { sections: secs, items: allItems } = mergeSections(batches);
      setSections(secs);
      setItems(allItems);
      onSectionsChangeRef.current?.(
        secs.map((s) => ({ key: s.key, label: s.label })),
        secs.length > 1
      );
      const keys = new Set<string>(secs.map((s) => s.key));
      const current = controlledKey ?? internalKey;
      if (!keys.has(current)) {
        const preferred = secs[0]?.key || "";
        if (onSectionKeyChangeRef.current) {
          onSectionKeyChangeRef.current(preferred);
        } else {
          setInternalKey(preferred);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onSectionsChangeRef.current?.([], false);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload on path/preset set
  }, [pathsKey, presetKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeSection = useMemo(
    () => sections.find((s) => s.key === sectionKey) || sections[0],
    [sections, sectionKey]
  );

  const people = useMemo(() => {
    const list = activeSection?.people ?? [];
    return list.length > 1 ? list : [];
  }, [activeSection]);

  const activePerson = useMemo(() => {
    if (!people.length) return null;
    return people.find((p) => p.key === personKey) || people[0] || null;
  }, [people, personKey]);

  useEffect(() => {
    if (!people.length) {
      onPeopleChangeRef.current?.([]);
      return;
    }
    onPeopleChangeRef.current?.(
      people.map((p) => ({ key: p.key, label: p.label }))
    );
    if (!people.some((p) => p.key === personKey)) {
      setPersonKey(people[0].key);
    }
  }, [people, personKey]);

  const subsections = useMemo(() => {
    if (activePerson) {
      return (activePerson.subsections ?? []).filter((s) => s.items.length > 0);
    }
    return activeSubsections(activeSection);
  }, [activePerson, activeSection]);

  useEffect(() => {
    if (!subsections.length) {
      setSubsectionKey("");
      onSubsectionsChangeRef.current?.([]);
      return;
    }
    onSubsectionsChangeRef.current?.(
      subsections.map((s) => ({ key: s.key, label: s.label }))
    );
    if (!subsections.some((s) => s.key === subsectionKey)) {
      setSubsectionKey(subsections[0].key);
    }
  }, [subsections, subsectionKey]);

  const visible = useMemo(() => {
    if (!activeSection) return items;
    const bucket = activePerson || activeSection;
    if (subsections.length) {
      const sub =
        subsections.find((s) => s.key === subsectionKey) || subsections[0];
      return sub?.items ?? [];
    }
    if (activePerson) {
      return activePerson.items || [];
    }
    if (sectionKey && sectionKey !== "all") {
      return bucket.items || [];
    }
    return sections[0]?.items || items;
  }, [
    activeSection,
    activePerson,
    items,
    sectionKey,
    subsections,
    subsectionKey,
    sections,
  ]);

  const viewerItems: GalleryViewerItem[] = useMemo(
    () =>
      visible
        .filter((it) => !isGalleryLinkItem(it))
        .map((it) => ({
          id: it.id,
          url: withMediaAccess(it.url),
          caption: it.title,
          mediaType: mediaKind(it),
        })),
    [visible]
  );

  if (loading) {
    return <PlaylistBoot className="playlist-boot--compact" label="Loading gallery…" />;
  }
  if (error) {
    return <p className="error artist-section-empty">{error}</p>;
  }
  if (!items.length) {
    return <p className="muted artist-section-empty">No images found.</p>;
  }

  return (
    <div className="series-gallery">
      {!hideSubbar && sections.length > 1 ? (
        <nav
          className="series-section-subbar"
          role="tablist"
          aria-label="Gallery folders"
        >
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              className={sectionKey === s.key ? "active" : ""}
              onClick={() => setSectionKey(s.key)}
            >
              {s.label}
            </button>
          ))}
        </nav>
      ) : null}
      {people.length > 1 && !(hideSubbar && onPeopleChange) ? (
        <nav
          className="series-section-subbar"
          role="tablist"
          aria-label="Exclusive people"
        >
          {people.map((p) => (
            <button
              key={p.key}
              type="button"
              className={personKey === p.key ? "active" : ""}
              onClick={() => setPersonKey(p.key)}
            >
              {p.label}
            </button>
          ))}
        </nav>
      ) : null}
      {subsections.length > 1 &&
      !(hideSubbar && onSubsectionsChange) ? (
        <nav
          className="series-section-subbar"
          role="tablist"
          aria-label="Exclusive folders"
        >
          {subsections.map((s) => (
            <button
              key={s.key}
              type="button"
              className={subsectionKey === s.key ? "active" : ""}
              onClick={() => setSubsectionKey(s.key)}
            >
              {s.label}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="artist-gallery__photo-grid series-gallery__grid">
        {visible.map((it) => {
          const url = withMediaAccess(it.url);
          if (isGalleryLinkItem(it)) {
            return (
              <a
                key={it.id}
                className="artist-gallery__photo-card artist-gallery__photo-card--link"
                href={it.url}
                target="_blank"
                rel="noopener noreferrer"
                title={it.title}
              >
                <span className="artist-gallery__link-card" aria-hidden>
                  <IconExternalLink />
                </span>
                <span className="artist-gallery__card-label">{it.title}</span>
              </a>
            );
          }
          const kind = mediaKind(it);
          const viewerIdx = viewerItems.findIndex((v) => v.id === it.id);
          const isLogo =
            (it.title || "").trim().toLowerCase() === "logo" ||
            (it.id || "").toLowerCase().includes("logo");
          return (
            <button
              key={it.id}
              type="button"
              className={`artist-gallery__photo-card${
                isLogo ? " artist-gallery__photo-card--logo" : ""
              }`}
              onClick={() => {
                if (viewerIdx >= 0) setViewerIndex(viewerIdx);
              }}
              title={it.title}
            >
              {kind === "video" ? (
                <video
                  src={url}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  draggable={false}
                />
              ) : kind === "audio" ? (
                <span className="artist-gallery__audio-card" aria-hidden>
                  ♪
                </span>
              ) : (
                <img src={url} alt={it.title} loading="lazy" draggable={false} />
              )}
              <span className="artist-gallery__card-label">{it.title}</span>
            </button>
          );
        })}
      </div>
      {viewerIndex != null ? (
        <GalleryViewerModal
          items={viewerItems}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
        />
      ) : null}
    </div>
  );
}
