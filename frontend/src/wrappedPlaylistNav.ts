/** Navigation + fill state for `{year} Wrapped` user playlists. */

export type WrappedPlaylistModule =
  | "music"
  | "series"
  | "movies"
  | "books"
  | "games";

export type WrappedPlaylistEntry = {
  playlistId: number;
  module: WrappedPlaylistModule;
};

const ENTRY_KEY = "mystack_wrapped_playlist_entry";
const FILL_PREFIX = "mystack_wrapped_fill_v1:";

let entryMemory: WrappedPlaylistEntry | null = null;

function fillKey(year: number, module: string): string {
  return `${FILL_PREFIX}${year}:${String(module || "music").toLowerCase()}`;
}

export function markWrappedModuleFilled(year: number, module: string): void {
  try {
    sessionStorage.setItem(fillKey(year, module), "1");
  } catch {
    /* ignore */
  }
}

export function isWrappedModuleFilled(year: number, module: string): boolean {
  try {
    return sessionStorage.getItem(fillKey(year, module)) === "1";
  } catch {
    return false;
  }
}

export function saveWrappedPlaylistEntry(
  entry: WrappedPlaylistEntry | null
): void {
  entryMemory = entry;
  try {
    if (!entry) sessionStorage.removeItem(ENTRY_KEY);
    else sessionStorage.setItem(ENTRY_KEY, JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

export function getWrappedPlaylistEntry(): WrappedPlaylistEntry | null {
  if (entryMemory) return entryMemory;
  try {
    const raw = sessionStorage.getItem(ENTRY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WrappedPlaylistEntry;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.playlistId !== "number") return null;
    const mod = String(parsed.module || "").toLowerCase();
    if (
      mod !== "music" &&
      mod !== "series" &&
      mod !== "movies" &&
      mod !== "books" &&
      mod !== "games"
    ) {
      return null;
    }
    entryMemory = { playlistId: parsed.playlistId, module: mod };
    return entryMemory;
  } catch {
    return null;
  }
}

export function takeWrappedPlaylistEntry(): WrappedPlaylistEntry | null {
  const entry = getWrappedPlaylistEntry();
  saveWrappedPlaylistEntry(null);
  return entry;
}

export function clearWrappedPlaylistEntry(): void {
  saveWrappedPlaylistEntry(null);
}

export function normalizeWrappedModule(
  value: string | null | undefined
): WrappedPlaylistModule {
  const mod = String(value || "music").trim().toLowerCase();
  if (
    mod === "series" ||
    mod === "movies" ||
    mod === "books" ||
    mod === "games"
  ) {
    return mod;
  }
  return "music";
}
