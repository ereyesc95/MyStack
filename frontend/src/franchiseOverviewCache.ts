import type { SeriesOverview } from "./types";
import {
  clearSessionNamespace,
  readSessionEntry,
  sessionCacheKey,
  writeSessionEntry,
} from "./sessionCache";

const NAMESPACE = "franchise-overview-v9";
const MAX_ENTRIES = 48;
const overviewCache = new Map<string, SeriesOverview>();

function trimMemory(): void {
  while (overviewCache.size > MAX_ENTRIES) {
    const oldest = overviewCache.keys().next().value;
    if (oldest === undefined) break;
    overviewCache.delete(oldest);
  }
}

function siblingFranchiseCacheKey(key: string): string | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const mod = key.slice(0, colon);
  const id = key.slice(colon + 1);
  if (!id) return null;
  if (mod === "series") return `movies:${id}`;
  if (mod === "movies") return `series:${id}`;
  return null;
}

export function readFranchiseOverviewCache(key: string): SeriesOverview | null {
  const mem = overviewCache.get(key);
  if (mem) {
    // Refresh LRU order.
    overviewCache.delete(key);
    overviewCache.set(key, mem);
    return mem;
  }
  const stored = readSessionEntry<SeriesOverview>(
    sessionCacheKey(NAMESPACE, key)
  );
  if (stored) {
    overviewCache.set(key, stored);
    trimMemory();
    return stored;
  }
  // Fall back to Series↔Movies sibling when shared franchise was already loaded.
  const sibling = siblingFranchiseCacheKey(key);
  if (!sibling) return null;
  const sibMem = overviewCache.get(sibling);
  if (sibMem) {
    overviewCache.set(key, sibMem);
    trimMemory();
    return sibMem;
  }
  const sibStored = readSessionEntry<SeriesOverview>(
    sessionCacheKey(NAMESPACE, sibling)
  );
  if (sibStored) {
    overviewCache.set(key, sibStored);
    trimMemory();
    return sibStored;
  }
  return null;
}

export function writeFranchiseOverviewCache(
  key: string,
  data: SeriesOverview
): void {
  if (overviewCache.has(key)) overviewCache.delete(key);
  overviewCache.set(key, data);
  trimMemory();
  writeSessionEntry(sessionCacheKey(NAMESPACE, key), data);
  // Shared Series↔Movies franchises (e.g. Dragon Ball) — warm the sibling key
  // so opening from the other module's Wrapped does not cold-fetch again.
  const shared = Boolean(
    (data as SeriesOverview & { shared_series?: boolean }).shared_series
  );
  if (!shared) return;
  const colon = key.indexOf(":");
  if (colon < 0) return;
  const mod = key.slice(0, colon);
  const id = key.slice(colon + 1);
  if (!id) return;
  const sibling =
    mod === "series" ? `movies:${id}` : mod === "movies" ? `series:${id}` : null;
  if (!sibling || sibling === key) return;
  if (overviewCache.has(sibling)) overviewCache.delete(sibling);
  overviewCache.set(sibling, data);
  writeSessionEntry(sessionCacheKey(NAMESPACE, sibling), data);
}

export function clearFranchiseOverviewCache(): void {
  overviewCache.clear();
  clearSessionNamespace(NAMESPACE);
}
