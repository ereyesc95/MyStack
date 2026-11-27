import { useLayoutEffect, useRef, useState } from "react";

/**
 * Gate entrance animations to a cold first reveal.
 * If `ready` is already true on first paint for this identity (cache/refresh),
 * skip the intro and just show chrome.
 */
export function useFirstLoadIntro(
  ready: boolean,
  identity: string
): { show: boolean; intro: boolean } {
  const meta = useRef<{ id: string; cold: boolean }>({
    id: identity,
    cold: !ready,
  });
  if (meta.current.id !== identity) {
    meta.current = { id: identity, cold: !ready };
  }

  const [intro, setIntro] = useState(false);

  useLayoutEffect(() => {
    if (!ready) {
      setIntro(false);
      return;
    }
    if (!meta.current.cold) {
      setIntro(false);
      return;
    }
    // Consume cold wait → ready so refresh/cache hits never animate.
    meta.current.cold = false;
    setIntro(true);
    const t = window.setTimeout(() => setIntro(false), 320);
    return () => window.clearTimeout(t);
  }, [ready, identity]);

  return { show: ready, intro: ready && intro };
}
