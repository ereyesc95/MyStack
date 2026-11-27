import { fetchWordCloud } from "./api";
import {
  readSessionEntry,
  removeSessionEntry,
  sessionCacheKey,
  writeSessionEntry,
} from "./sessionCache";
import type { WordCloudPayload } from "./types";

const MAX_ENTRIES = 24;
const NAMESPACE = "artist-word-cloud";

type CacheKey = `${number}`;

const store = new Map<CacheKey, WordCloudPayload>();
const inflight = new Map<CacheKey, Promise<WordCloudPayload>>();

function cacheKey(bandId: number): CacheKey {
  return `${bandId}`;
}

function sessionKey(bandId: number): string {
  return sessionCacheKey(NAMESPACE, cacheKey(bandId));
}

export function rememberArtistWordCloud(
  bandId: number,
  entry: WordCloudPayload
): void {
  const key = cacheKey(bandId);
  if (store.has(key)) store.delete(key);
  store.set(key, entry);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  writeSessionEntry(sessionKey(bandId), entry);
}

export function getCachedArtistWordCloud(
  bandId: number
): WordCloudPayload | null {
  const key = cacheKey(bandId);
  const mem = store.get(key);
  if (mem) return mem;
  const fromSession = readSessionEntry<WordCloudPayload>(sessionKey(bandId));
  if (fromSession) {
    store.set(key, fromSession);
    return fromSession;
  }
  return null;
}

export function clearArtistWordCloudCache(bandId?: number): void {
  if (bandId != null) {
    const key = cacheKey(bandId);
    store.delete(key);
    inflight.delete(key);
    removeSessionEntry(sessionKey(bandId));
    return;
  }
  store.clear();
  inflight.clear();
}

export function prefetchArtistWordCloud(
  bandId: number,
  options?: { force?: boolean }
): Promise<WordCloudPayload> {
  const key = cacheKey(bandId);
  const force = options?.force ?? false;
  if (!force) {
    const cached = getCachedArtistWordCloud(bandId);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const req = fetchWordCloud(bandId)
    .then((payload) => {
      rememberArtistWordCloud(bandId, payload);
      return payload;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, req);
  return req;
}
