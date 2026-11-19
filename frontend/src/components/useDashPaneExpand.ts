import { useCallback, useEffect, useRef, useState } from "react";

/** Brief pause before expand so fast cursor sweeps don't thrash every card. */
const EXPAND_DELAY_MS = 100;
const COLLAPSE_DELAY_MS = 150;

/** Prefetch hover morph images so expand doesn't flash empty. */
export function prefetchDashArt(urls: Array<string | null | undefined>): void {
  for (const url of urls) {
    if (!url || typeof window === "undefined") continue;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  }
}

/**
 * Desktop: hover expands a card after a short delay; leave collapses after a delay.
 * Mobile: `revealedId` from useDashCardReveal drives expand (tap 1).
 */
export function useDashPaneExpand(
  revealedId: string | null,
  coarse: boolean
): {
  expandedId: string | null;
  onEnter: (id: string) => void;
  onLeave: () => void;
} {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const pendingIdRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const onEnter = useCallback(
    (id: string) => {
      if (coarse) return;
      clearTimer();
      pendingIdRef.current = id;
      // Already on this card — keep expanded without re-delaying.
      if (hoveredId === id) return;
      timerRef.current = window.setTimeout(() => {
        if (pendingIdRef.current === id) {
          setHoveredId(id);
        }
        timerRef.current = null;
      }, EXPAND_DELAY_MS);
    },
    [coarse, clearTimer, hoveredId]
  );

  const onLeave = useCallback(() => {
    if (coarse) return;
    clearTimer();
    pendingIdRef.current = null;
    timerRef.current = window.setTimeout(() => {
      setHoveredId(null);
      timerRef.current = null;
    }, COLLAPSE_DELAY_MS);
  }, [coarse, clearTimer]);

  return {
    expandedId: coarse ? revealedId : hoveredId,
    onEnter,
    onLeave,
  };
}
