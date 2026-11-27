/** Decode (or fail) an image URL before swapping page chrome. */
export function preloadImage(url: string | null | undefined): Promise<void> {
  const src = (url || "").trim();
  if (!src) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    img.onload = done;
    img.onerror = done;
    // Cached images may already be complete synchronously.
    img.src = src;
    if (img.complete) done();
  });
}

export function preloadImages(
  urls: Array<string | null | undefined>
): Promise<void> {
  const unique = [...new Set(urls.map((u) => (u || "").trim()).filter(Boolean))];
  if (!unique.length) return Promise.resolve();
  return Promise.all(unique.map((u) => preloadImage(u))).then(() => undefined);
}
