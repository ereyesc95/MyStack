import { recordModuleActivity, type ModuleActivityRecordIn } from "./api";
import type { ModuleWrappedKind } from "./types";

/** Fire-and-forget activity for non-music Wrapped (never blocks UI). */
export function trackModuleActivity(body: ModuleActivityRecordIn): void {
  const module = (body.module || "").trim().toLowerCase();
  const entityId = (body.entity_id || "").trim();
  if (!module || !entityId) return;
  void recordModuleActivity({ ...body, module, entity_id: entityId }).catch(
    () => undefined
  );
}

export function moduleFromMediaPath(
  path: string | null | undefined
): ModuleWrappedKind | null {
  const p = (path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const head = p.split("/")[0]?.toLowerCase() || "";
  if (head === "series") return "series";
  if (head === "movies") return "movies";
  if (head === "books") return "books";
  if (head === "games") return "games";
  if (head === "files") return "files";
  if (head === "hobbies") return "hobbies";
  return null;
}

/** Infer franchise folder name from Series|Movies|Books|Games path. */
export function franchiseNameFromMediaPath(
  path: string | null | undefined
): string | null {
  const parts = (path || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  // Games/{Platform}/{Letter}/{Franchise}/…
  if (parts[0]?.toLowerCase() === "games" && parts.length >= 4) {
    return parts[3] || null;
  }
  // {Module}/{Letter}/{Franchise}/…
  if (parts.length >= 3) return parts[2] || null;
  return null;
}
