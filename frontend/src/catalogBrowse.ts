import type { SeriesFilterOptions } from "./types";

/** Resolve a Wrapped vibe / About genre name (or numeric id) to a catalog subgenre id. */
export function resolveSubgenreId(
  options: SeriesFilterOptions | null | undefined,
  nameOrId: string | number | null | undefined
): number | "" {
  if (nameOrId == null || nameOrId === "") return "";
  if (typeof nameOrId === "number" && Number.isFinite(nameOrId)) {
    return nameOrId;
  }
  const raw = String(nameOrId).trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isNaN(n) ? "" : n;
  }
  const want = raw.toLowerCase();
  const groups = options?.subgenre_groups || [];
  for (const group of groups) {
    const hit = (group.items || []).find(
      (item) => (item.name || "").trim().toLowerCase() === want
    );
    if (hit?.id != null) return hit.id;
  }
  // Parent genre pill (e.g. "Action") → first child so the genre tab has a selection.
  for (const group of groups) {
    if ((group.genre || "").trim().toLowerCase() === want) {
      const first = group.items?.[0];
      if (first?.id != null) return first.id;
    }
  }
  // Soft match: IGDB "Platform" → catalog "Platformer" (prefer shortest).
  type SoftHit = { id: number; name: string };
  const soft: SoftHit[] = [];
  for (const group of groups) {
    for (const item of group.items || []) {
      const name = (item.name || "").trim();
      const lc = name.toLowerCase();
      if (
        item.id != null &&
        (lc.startsWith(want) ||
          want.startsWith(lc) ||
          lc.includes(want) ||
          want.includes(lc))
      ) {
        soft.push({ id: item.id, name });
      }
    }
  }
  if (soft.length) {
    soft.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
    return soft[0].id;
  }
  for (const group of groups) {
    const gname = (group.genre || "").trim().toLowerCase();
    if (
      gname.startsWith(want) ||
      want.startsWith(gname) ||
      gname.includes(want) ||
      want.includes(gname)
    ) {
      const first = group.items?.[0];
      if (first?.id != null) return first.id;
    }
  }
  return "";
}

export function vibeBrowseName(item: {
  vibe_key?: string | null;
  title?: string | null;
  name?: string | null;
  id?: string | number | null;
}): string {
  return (
    (item.vibe_key || item.title || item.name || item.id || "").toString().trim()
  );
}
