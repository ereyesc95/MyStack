/** CSS color → RGB helpers and dual-fill contrast for the MyStack mark. */

export type Rgb = { r: number; g: number; b: number };

const MIN_PAIR = 2.35;
const MIN_WRAPPED = 2.8;

export function parseCssColor(input: string): Rgb | null {
  const s = input.trim();
  if (!s) return null;
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  const rgbComma = s.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i
  );
  if (rgbComma) {
    return {
      r: clamp255(+rgbComma[1]),
      g: clamp255(+rgbComma[2]),
      b: clamp255(+rgbComma[3]),
    };
  }
  const rgbSpace = s.match(
    /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i
  );
  if (rgbSpace) {
    return {
      r: clamp255(+rgbSpace[1]),
      g: clamp255(+rgbSpace[2]),
      b: clamp255(+rgbSpace[3]),
    };
  }
  return null;
}

function clamp255(n: number) {
  return Math.min(255, Math.max(0, Math.round(n)));
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => clamp255(n).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function channelLin(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelLin(r) + 0.7152 * channelLin(g) + 0.0722 * channelLin(b)
  );
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** Push `fg` toward black or white until it clears `min` against every `against`. */
export function ensureContrast(
  fg: Rgb,
  against: Rgb[],
  min: number = MIN_PAIR
): Rgb {
  const ok = (c: Rgb) => against.every((bg) => contrastRatio(c, bg) >= min);
  if (ok(fg)) return fg;
  const black: Rgb = { r: 10, g: 12, b: 16 };
  const white: Rgb = { r: 255, g: 255, b: 255 };
  let best = fg;
  let bestScore = 0;
  for (const pole of [black, white]) {
    let lo = 0;
    let hi = 1;
    let found: Rgb | null = null;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      const cand = mix(fg, pole, mid);
      if (ok(cand)) {
        found = cand;
        hi = mid;
      } else {
        lo = mid;
      }
    }
    const cand = found ?? mix(fg, pole, 1);
    const score = against.reduce((s, bg) => s + contrastRatio(cand, bg), 0);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

export type MystackMarkColors = {
  frame: string;
  core: string;
  wrappedFrame: string;
  wrappedCore: string;
};

/**
 * Resolve dual-fill colors for the mark.
 * Frame = text; core = accent (punched if too close to text/bg).
 * Wrapped: frame on accent button; core = panels punched against accent.
 */
export function resolveMystackMarkColors(input: {
  text: string;
  accent: string;
  bg: string;
  panels: string;
  accentFg?: string;
}): MystackMarkColors {
  const text = parseCssColor(input.text) ?? { r: 232, g: 234, b: 239 };
  const accent = parseCssColor(input.accent) ?? { r: 0, g: 212, b: 200 };
  const bg = parseCssColor(input.bg) ?? { r: 10, g: 12, b: 16 };
  const panels = parseCssColor(input.panels) ?? { r: 18, g: 21, b: 28 };
  const accentFg =
    parseCssColor(input.accentFg ?? "") ??
    (relativeLuminance(accent) > 0.58
      ? { r: 10, g: 12, b: 16 }
      : { r: 255, g: 255, b: 255 });

  // Dual-tone within the glyph: core must read against the frame (text).
  // Do not also require contrast vs page bg — that fights light-text/dark-bg themes.
  let core = ensureContrast(accent, [text], MIN_PAIR);
  // If punching for text made core vanish into the page, ease back toward accent.
  if (contrastRatio(core, bg) < 1.45) {
    core = mix(core, accent, 0.55);
    core = ensureContrast(core, [text], Math.min(MIN_PAIR, 1.9));
  }

  const wrappedCore = ensureContrast(panels, [accent], MIN_WRAPPED);
  const wrappedFrame = ensureContrast(accentFg, [accent], MIN_WRAPPED);

  return {
    frame: rgbToHex(text),
    core: rgbToHex(core),
    wrappedFrame: rgbToHex(wrappedFrame),
    wrappedCore: rgbToHex(wrappedCore),
  };
}

/** Write --mystack-* vars from computed theme tokens (call after theme apply). */
export function syncMystackMarkCssVars(root: HTMLElement = document.documentElement) {
  const styles = getComputedStyle(root);
  const colors = resolveMystackMarkColors({
    text: styles.getPropertyValue("--text").trim(),
    accent: styles.getPropertyValue("--accent").trim(),
    bg: styles.getPropertyValue("--bg").trim(),
    panels: styles.getPropertyValue("--bg-elevated").trim(),
    accentFg: styles.getPropertyValue("--accent-fg").trim(),
  });
  root.style.setProperty("--mystack-core", colors.core);
  root.style.setProperty("--mystack-wrapped-frame", colors.wrappedFrame);
  root.style.setProperty("--mystack-wrapped-core", colors.wrappedCore);
  return colors;
}
