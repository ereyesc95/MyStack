import {
  MYSTACK_DEFAULT_ACCENT,
  MYSTACK_DEFAULT_FILL,
  mystackMarkSvg,
} from "./mystackMark";
import { syncMystackMarkCssVars } from "./mystackContrast";

export function updateFavicon() {
  const colors = syncMystackMarkCssVars();
  const body = colors.frame || MYSTACK_DEFAULT_FILL;
  const accent = colors.core || MYSTACK_DEFAULT_ACCENT;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  // No hole inset — dual-fill stays crisp at favicon size.
  link.href = `data:image/svg+xml,${encodeURIComponent(
    mystackMarkSvg(body, accent, { holeInset: false })
  )}`;
}
