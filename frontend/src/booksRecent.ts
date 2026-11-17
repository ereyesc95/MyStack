const RECENT_KEY = "mystack.books.recent";

export function getRecentBookIds(limit = 24): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, limit);
  } catch {
    return [];
  }
}

export function pushRecentBookId(bookId: string, limit = 24): void {
  const id = (bookId || "").trim();
  if (!id) return;
  const next = [id, ...getRecentBookIds(limit).filter((x) => x !== id)].slice(
    0,
    limit
  );
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}
