import { openLocalMediaFile } from "./api";
import {
  franchiseNameFromMediaPath,
  moduleFromMediaPath,
  trackModuleActivity,
} from "./moduleActivity";

export type CatalogVideoActivity = {
  title?: string | null;
  entityId?: string | null;
  franchiseId?: string | null;
  franchiseTitle?: string | null;
  coverUrl?: string | null;
  vibeKey?: string | null;
  vibeLabel?: string | null;
};

/** Extract media-root-relative path from /api/media/file or open-local URLs. */
export function mediaPathFromOpenUrl(url: string): string | null {
  const trimmed = (url || "").trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed, window.location.origin);
    if (
      u.pathname.includes("/api/media/file") ||
      u.pathname.includes("/api/media/open-local")
    ) {
      const path = u.searchParams.get("path");
      return path?.trim() || null;
    }
  } catch {
    /* ignore */
  }
  const m = trimmed.match(/[?&]path=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]).trim() || null;
    } catch {
      return m[1].trim() || null;
    }
  }
  return null;
}

function isExternalHttp(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url, window.location.origin);
    return !u.pathname.includes("/api/media/");
  } catch {
    return true;
  }
}

function fileUrlForPath(path: string): string {
  return `/api/media/file?path=${encodeURIComponent(path)}`;
}

function openInBrowserTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

function recordCatalogPlayback(
  path: string | null,
  activity?: CatalogVideoActivity | null
): void {
  if (!path) return;
  const mod = moduleFromMediaPath(path);
  if (mod !== "series" && mod !== "movies") return;
  const franchiseTitle =
    activity?.franchiseTitle || franchiseNameFromMediaPath(path);
  trackModuleActivity({
    module: mod,
    entity_kind: mod === "series" ? "episode" : "film",
    entity_id: (activity?.entityId || path).trim(),
    title: activity?.title || undefined,
    path,
    franchise_id: activity?.franchiseId || franchiseTitle || undefined,
    franchise_title: franchiseTitle || undefined,
    cover_url: activity?.coverUrl || undefined,
    vibe_key: activity?.vibeKey || undefined,
    vibe_label: activity?.vibeLabel || undefined,
  });
}

/**
 * Open a Movies/Series catalog video.
 * - External http(s) links always open in a tab.
 * - When playLocally: OS associated app via open-local; fall back to browser tab.
 * - When not: browser tab (file stream URL).
 * Records Series/Movies Wrapped activity on local playback start.
 */
export async function openCatalogVideo(opts: {
  openUrl?: string | null;
  playPath?: string | null;
  playLocally: boolean;
  activity?: CatalogVideoActivity | null;
}): Promise<void> {
  const url = (opts.openUrl || "").trim();
  const playPath = (opts.playPath || "").trim() || null;
  if (!url && !playPath) return;

  if (url && isExternalHttp(url)) {
    openInBrowserTab(url);
    return;
  }

  const path = playPath || (url ? mediaPathFromOpenUrl(url) : null);
  recordCatalogPlayback(path, opts.activity);

  if (opts.playLocally && path) {
    try {
      await openLocalMediaFile(path);
      return;
    } catch {
      /* fall through to browser */
    }
  }

  if (url && !url.includes("/api/media/open-local")) {
    openInBrowserTab(url);
    return;
  }
  if (path) {
    openInBrowserTab(fileUrlForPath(path));
  }
}
