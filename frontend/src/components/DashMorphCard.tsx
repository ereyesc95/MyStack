import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { MusicDashPreview } from "../types";
import DashCardPreview, {
  EMPTY_OVERLAY,
  type DashPreviewOverlay,
} from "./DashCardPreview";
import {
  killDashPreviewsForMainPlay,
  setDashPreviewBackdrop,
} from "../dashPreviewController";
import { usePhoneLayout } from "../usePhoneLayout";

const LINE_FADE_MS = 400;

type LingerSecondary = {
  logo: string | null;
  icon: string | null;
  text: string | null;
};

export type DashMorphShape =
  | "square"
  | "circle"
  | "landscape"
  | "portrait"
  | "flag";

export type DashMorphPreview = {
  requestKey: string;
  load: () => Promise<MusicDashPreview | null>;
  /** Media title line with play icon (Best Artists / Records / Vibes / Origins). */
  showMediaCaption?: boolean;
  /** On Repeat: play glyph on the existing title-over-brand line (no extra caption). */
  playIconOnTitle?: boolean;
  /** Swap/add preview artist brand under primary (Vibes / Origins). */
  showPreviewArtist?: boolean;
};

type Props = {
  id: string;
  title: string;
  shape: DashMorphShape;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  landscapeUrl?: string | null;
  logoUrl?: string | null;
  logoCollapsedUrl?: string | null;
  /** Artist/franchise icon shown to the left of the logo (or title). */
  iconUrl?: string | null;
  /** Secondary brand under primary (e.g. artist under album). */
  secondaryLogoUrl?: string | null;
  secondaryLogoCollapsedUrl?: string | null;
  secondaryIconUrl?: string | null;
  secondaryTitle?: string | null;
  /** Parent genre (Vibes) — shown under title when expanded. */
  parentLine?: string | null;
  /** Country ISO for left circle flag when expanded / idle fill. */
  flagIso?: string | null;
  /**
   * On Repeat: show track title above the artist mark.
   * Top Records / Best panes: leave false so mark OR text (never both).
   */
  titleOverBrand?: boolean;
  /** Hover action under brands (Play game / Read book / …). */
  actionLabel?: string | null;
  onAction?: (e: MouseEvent<HTMLElement>) => void;
  expanded: boolean;
  revealed?: boolean;
  className?: string;
  active?: boolean;
  preview?: DashMorphPreview | null;
  onEnter: (id: string) => void;
  onLeave: () => void;
  onActivate: (e: MouseEvent<HTMLElement>) => void;
  children?: ReactNode;
};

function PlayGlyph() {
  return (
    <svg
      className="dash-morph__play-glyph"
      viewBox="0 0 12 12"
      width="11"
      height="11"
      aria-hidden
    >
      <path d="M3.2 1.6v8.8l7.2-4.4z" fill="currentColor" />
    </svg>
  );
}

function pickExpandedBg(
  bannerUrl?: string | null,
  landscapeUrl?: string | null,
  coverUrl?: string | null,
  preferLandscape = false
): string | null {
  if (preferLandscape) {
    return landscapeUrl || bannerUrl || coverUrl || null;
  }
  return bannerUrl || landscapeUrl || coverUrl || null;
}

function cleanUrl(u?: string | null): string | null {
  const s = (u || "").trim();
  return s || null;
}

/** Logo candidates: full wordmark first, then collapsed (icon is never a candidate). */
function logoCandidates(
  logo?: string | null,
  collapsed?: string | null
): string[] {
  const out: string[] = [];
  for (const u of [logo, collapsed]) {
    const s = cleanUrl(u);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** "Play game" → "Play game"; "PLAY EPISODE 1" → "Play episode 1" */
function sentenceCaseLabel(label: string): string {
  const t = label.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Strip YYYY. / YYYY.MM. / YYYY.MM.DD. prefixes from display lines. */
function stripDatePrefix(text: string | null | undefined): string | null {
  const t = (text || "").trim();
  if (!t) return null;
  return t.replace(/^\d{4}(?:\.\d{1,2}){0,2}\.\s*/, "").trim() || t;
}

export default function DashMorphCard({
  id,
  title,
  shape,
  coverUrl,
  bannerUrl,
  landscapeUrl,
  logoUrl,
  logoCollapsedUrl,
  iconUrl,
  secondaryLogoUrl,
  secondaryLogoCollapsedUrl,
  secondaryIconUrl,
  secondaryTitle,
  parentLine = null,
  flagIso,
  titleOverBrand = false,
  actionLabel = null,
  onAction,
  expanded,
  revealed = false,
  className = "",
  active = false,
  preview = null,
  onEnter,
  onLeave,
  onActivate,
  children,
}: Props) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const phone = usePhoneLayout();
  const [previewOverlay, setPreviewOverlay] =
    useState<DashPreviewOverlay>(EMPTY_OVERLAY);
  const onOverlay = useCallback((s: DashPreviewOverlay) => {
    setPreviewOverlay(s);
  }, []);

  const previewArmed = Boolean(
    preview && (expanded || revealed)
  );
  const previewActive = previewOverlay.active;

  // Page atmosphere: landscape of the hovered media while preview is live.
  useEffect(() => {
    if (!previewActive) {
      setDashPreviewBackdrop(null);
      return;
    }
    const url =
      cleanUrl(landscapeUrl) ||
      cleanUrl(bannerUrl) ||
      cleanUrl(previewOverlay.artworkUrl) ||
      cleanUrl(coverUrl);
    setDashPreviewBackdrop(url);
    return () => setDashPreviewBackdrop(null);
  }, [
    previewActive,
    landscapeUrl,
    bannerUrl,
    coverUrl,
    previewOverlay.artworkUrl,
  ]);

  const idleBg = coverUrl || landscapeUrl || bannerUrl || null;
  // Mobile tap expand: landscape art + 16:9 frame (banner remains desktop hover).
  const expandedBg = pickExpandedBg(
    bannerUrl,
    landscapeUrl,
    coverUrl,
    phone
  );
  const previewArt =
    previewActive && previewOverlay.mediaKind === "audio"
      ? cleanUrl(previewOverlay.artworkUrl)
      : null;

  const usePreviewArtist =
    previewActive &&
    Boolean(preview?.showPreviewArtist) &&
    Boolean(
      previewOverlay.artistLogoUrl ||
        previewOverlay.artistLogoCollapsedUrl ||
        previewOverlay.artistName
    );

  const primaryLogoOptions = logoCandidates(logoUrl, logoCollapsedUrl);
  const secondaryLogoOptions = usePreviewArtist
    ? logoCandidates(
        previewOverlay.artistLogoUrl,
        previewOverlay.artistLogoCollapsedUrl
      )
    : logoCandidates(secondaryLogoUrl, secondaryLogoCollapsedUrl);
  const companionIconUrl = cleanUrl(iconUrl);
  const secondaryCompanionIconUrl = usePreviewArtist
    ? cleanUrl(previewOverlay.artistIconUrl)
    : cleanUrl(secondaryIconUrl);
  const effectiveSecondaryTitle = stripDatePrefix(
    usePreviewArtist ? previewOverlay.artistName : secondaryTitle
  );

  const [logoIndex, setLogoIndex] = useState(0);
  const [iconFailed, setIconFailed] = useState(false);
  const [secondaryLogoIndex, setSecondaryLogoIndex] = useState(0);
  const [secondaryIconFailed, setSecondaryIconFailed] = useState(false);

  const primaryLogoKey = primaryLogoOptions.join("|");
  const secondaryLogoKey = secondaryLogoOptions.join("|");
  useEffect(() => {
    setLogoIndex(0);
  }, [primaryLogoKey]);
  useEffect(() => {
    setIconFailed(false);
  }, [companionIconUrl]);
  useEffect(() => {
    setSecondaryLogoIndex(0);
  }, [secondaryLogoKey]);
  useEffect(() => {
    setSecondaryIconFailed(false);
  }, [secondaryCompanionIconUrl]);

  const logoMark =
    logoIndex < primaryLogoOptions.length
      ? primaryLogoOptions[logoIndex]
      : null;
  const companionIcon = iconFailed ? null : companionIconUrl;
  const secondaryLogoMark =
    secondaryLogoIndex < secondaryLogoOptions.length
      ? secondaryLogoOptions[secondaryLogoIndex]
      : null;
  const secondaryCompanionIcon = secondaryIconFailed
    ? null
    : secondaryCompanionIconUrl;

  const isFlag = Boolean(flagIso) || shape === "flag";
  const showFlagBadge = expanded && Boolean(flagIso);
  const displayTitle = stripDatePrefix(title) || title;
  const displayParentLine = stripDatePrefix(parentLine);

  // Origins: once preview loads, hide the flag circle and show artist/media brand.
  const flagPreviewLogo = showFlagBadge && previewActive ? secondaryLogoMark : null;
  const flagPreviewTitle =
    showFlagBadge && previewActive && !flagPreviewLogo
      ? effectiveSecondaryTitle
      : null;
  const flagPreviewIcon =
    showFlagBadge && previewActive && Boolean(secondaryCompanionIcon)
      ? secondaryCompanionIcon
      : null;
  const flagShowsPreview = Boolean(
    previewActive && (flagPreviewLogo || flagPreviewTitle || flagPreviewIcon)
  );
  const flagLabelText = flagShowsPreview
    ? flagPreviewTitle || null
    : previewActive
      ? null
      : displayTitle || null;
  const showFlagCircle = showFlagBadge && !previewActive;

  // Vibes / genre cards: once preview loads, hide genre/subgenre branding and
  // show artist (icon+logo/name) + media title instead.
  const hideGenreBrandForPreview = usePreviewArtist;
  const showTitleOver =
    expanded &&
    !showFlagBadge &&
    !hideGenreBrandForPreview &&
    titleOverBrand &&
    Boolean(displayTitle) &&
    Boolean(logoMark);
  const showTitleAlone =
    expanded &&
    !showFlagBadge &&
    !hideGenreBrandForPreview &&
    !logoMark &&
    Boolean(displayTitle);
  const showPrimaryLogo =
    expanded &&
    !showFlagBadge &&
    !hideGenreBrandForPreview &&
    Boolean(logoMark);
  const showPrimaryIcon =
    expanded &&
    !showFlagBadge &&
    !hideGenreBrandForPreview &&
    Boolean(companionIcon) &&
    (showPrimaryLogo || showTitleAlone || showTitleOver);
  const showParentLine =
    expanded &&
    !showFlagBadge &&
    !hideGenreBrandForPreview &&
    Boolean(displayParentLine);
  // Origins preview brand lives in the flag row — don't duplicate under it.
  const showSecondaryLogo =
    expanded && !showFlagBadge && Boolean(secondaryLogoMark);
  const showSecondaryText =
    expanded &&
    !showFlagBadge &&
    !secondaryLogoMark &&
    Boolean(effectiveSecondaryTitle);
  const showSecondaryIcon =
    expanded &&
    !showFlagBadge &&
    Boolean(secondaryCompanionIcon) &&
    (showSecondaryLogo || showSecondaryText);
  const showPlayOnTitle =
    expanded && previewActive && Boolean(preview?.playIconOnTitle);
  const showMediaCaption =
    expanded &&
    previewActive &&
    Boolean(preview?.showMediaCaption) &&
    !preview?.playIconOnTitle &&
    Boolean(previewOverlay.mediaTitle);
  const showAction =
    expanded && !showFlagBadge && Boolean(actionLabel) && Boolean(onAction);
  const showStackLive =
    showTitleOver ||
    showTitleAlone ||
    showPrimaryLogo ||
    showPrimaryIcon ||
    showParentLine ||
    showSecondaryLogo ||
    showSecondaryText ||
    showSecondaryIcon ||
    showMediaCaption ||
    showAction;

  const primaryRow =
    showPrimaryIcon || showPrimaryLogo || (showTitleAlone && !showTitleOver);
  const secondaryRow =
    showSecondaryIcon || showSecondaryLogo || showSecondaryText;

  // Keep brand lines mounted briefly so they can fade out on collapse / preview end.
  const [stackMount, setStackMount] = useState(false);
  const [stackOn, setStackOn] = useState(false);
  const stackWanted = Boolean(expanded && showStackLive);
  useEffect(() => {
    if (stackWanted) {
      setStackMount(true);
      const raf = requestAnimationFrame(() => setStackOn(true));
      return () => cancelAnimationFrame(raf);
    }
    setStackOn(false);
    const t = window.setTimeout(() => setStackMount(false), LINE_FADE_MS);
    return () => window.clearTimeout(t);
  }, [stackWanted]);

  const [secMount, setSecMount] = useState(false);
  const [secOn, setSecOn] = useState(false);
  const [secHeld, setSecHeld] = useState<LingerSecondary | null>(null);
  useEffect(() => {
    if (secondaryRow) {
      setSecHeld({
        logo: secondaryLogoMark,
        icon: secondaryCompanionIcon,
        text: effectiveSecondaryTitle || null,
      });
      setSecMount(true);
      const raf = requestAnimationFrame(() => setSecOn(true));
      return () => cancelAnimationFrame(raf);
    }
    setSecOn(false);
    const t = window.setTimeout(() => {
      setSecMount(false);
      setSecHeld(null);
    }, LINE_FADE_MS);
    return () => window.clearTimeout(t);
  }, [
    secondaryRow,
    secondaryLogoMark,
    secondaryCompanionIcon,
    effectiveSecondaryTitle,
  ]);

  const [capMount, setCapMount] = useState(false);
  const [capOn, setCapOn] = useState(false);
  const [capHeld, setCapHeld] = useState<string | null>(null);
  useEffect(() => {
    if (showMediaCaption && previewOverlay.mediaTitle) {
      setCapHeld(previewOverlay.mediaTitle);
      setCapMount(true);
      const raf = requestAnimationFrame(() => setCapOn(true));
      return () => cancelAnimationFrame(raf);
    }
    setCapOn(false);
    const t = window.setTimeout(() => {
      setCapMount(false);
      setCapHeld(null);
    }, LINE_FADE_MS);
    return () => window.clearTimeout(t);
  }, [showMediaCaption, previewOverlay.mediaTitle]);

  const handleActivate = (e: MouseEvent<HTMLElement>) => {
    // Hard-stop preview so it cannot overlap main playback.
    killDashPreviewsForMainPlay();
    setPreviewOverlay(EMPTY_OVERLAY);
    onActivate(e);
  };

  return (
    <button
      ref={cardRef}
      type="button"
      data-dash-card={id}
      className={[
        "dash-morph",
        `dash-morph--${shape}`,
        isFlag ? "dash-morph--has-flag" : "",
        expanded ? "is-expanded" : "",
        revealed ? "is-revealed" : "",
        active ? "active" : "",
        previewActive ? "is-previewing" : "",
        previewActive && previewOverlay.mediaKind === "audio"
          ? "is-previewing-audio"
          : "",
        previewActive && previewOverlay.beating ? "is-beating" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={() => onEnter(id)}
      onMouseLeave={onLeave}
      onFocus={() => onEnter(id)}
      onBlur={onLeave}
      onClick={handleActivate}
    >
      <span className="dash-morph__frame">
        <span
          className="dash-morph__bg dash-morph__bg--idle card-bg-layer"
          style={
            idleBg ? { backgroundImage: `url("${idleBg}")` } : undefined
          }
        />
        <span
          className={`dash-morph__bg dash-morph__bg--wide card-bg-layer${
            expanded && expandedBg ? " is-on" : ""
          }`}
          style={
            expandedBg
              ? { backgroundImage: `url("${expandedBg}")` }
              : undefined
          }
        />
        {previewArt ? (
          <span
            className={`dash-morph__bg dash-morph__bg--preview-art card-bg-layer${
              previewActive ? " is-on" : ""
            }`}
            style={{ backgroundImage: `url("${previewArt}")` }}
          />
        ) : null}
        {preview ? (
          <DashCardPreview
            armed={previewArmed}
            requestKey={preview.requestKey}
            load={preview.load}
            onOverlay={onOverlay}
            beatHostRef={cardRef}
          />
        ) : null}
        {flagIso && (!expanded || !expandedBg) ? (
          <span
            className={`dash-morph__flag-idle fi fi-${flagIso}${
              expanded ? " is-expanded-fill" : ""
            }`}
          />
        ) : null}
        <span
          className={`dash-morph__scrim${expanded ? " is-on" : ""}`}
          aria-hidden
        />
        {showFlagBadge ? (
          <span
            className={`dash-morph__flag-row${
              stackMount && !flagShowsPreview
                ? " dash-morph__flag-row--with-stack"
                : ""
            }${flagShowsPreview ? " dash-morph__flag-row--preview" : ""}${
              previewActive ? " dash-morph__flag-row--no-flag" : ""
            }`}
          >
            {showFlagCircle ? (
              <span className="dash-morph__flag-badge" aria-hidden>
                <span className={`fi fi-${flagIso}`} />
              </span>
            ) : null}
            {flagPreviewIcon ? (
              <span className="dash-morph__icon dash-morph__icon--flag-preview">
                <img
                  src={flagPreviewIcon}
                  alt=""
                  draggable={false}
                  onError={() => setSecondaryIconFailed(true)}
                />
              </span>
            ) : null}
            {flagPreviewLogo ? (
              <span className="dash-morph__brand dash-morph__brand--flag-preview">
                <img
                  src={flagPreviewLogo}
                  alt=""
                  draggable={false}
                  onError={() => setSecondaryLogoIndex((i) => i + 1)}
                />
              </span>
            ) : null}
            {flagLabelText ? (
              <span
                className={`dash-morph__title dash-morph__title--flag${
                  flagShowsPreview ? " is-preview-label" : ""
                }`}
              >
                {flagLabelText}
              </span>
            ) : null}
          </span>
        ) : null}
        {stackMount ? (
          <span
            className={`dash-morph__brand-stack${
              showFlagBadge
                ? flagShowsPreview
                  ? " dash-morph__brand-stack--under-flag-preview"
                  : " dash-morph__brand-stack--under-flag"
                : ""
            }${stackOn ? " is-on" : ""}`}
          >
            {showTitleOver ? (
              <span
                className={`dash-morph__fade-line dash-morph__title dash-morph__title--over-brand${
                  showPlayOnTitle ? " dash-morph__title--with-play" : ""
                }${stackOn ? " is-on" : ""}`}
              >
                {showPlayOnTitle ? <PlayGlyph /> : null}
                <span>{displayTitle}</span>
              </span>
            ) : null}
            {primaryRow ? (
              <span
                className={`dash-morph__fade-line dash-morph__brand-row${
                  stackOn ? " is-on" : ""
                }`}
              >
                {showPrimaryIcon ? (
                  <span className="dash-morph__icon">
                    <img
                      src={companionIcon!}
                      alt=""
                      draggable={false}
                      onError={() => setIconFailed(true)}
                    />
                  </span>
                ) : null}
                {showPrimaryLogo ? (
                  <span
                    className={`dash-morph__brand${
                      titleOverBrand ||
                      secondaryRow ||
                      showMediaCaption ||
                      showParentLine ||
                      showAction
                        ? " dash-morph__brand--small"
                        : ""
                    }`}
                  >
                    <img
                      src={logoMark!}
                      alt=""
                      draggable={false}
                      onError={() => setLogoIndex((i) => i + 1)}
                    />
                  </span>
                ) : null}
                {showTitleAlone && !showTitleOver ? (
                  <span
                    className={`dash-morph__title dash-morph__title--inline${
                      showPlayOnTitle ? " dash-morph__title--with-play" : ""
                    }`}
                  >
                    {showPlayOnTitle ? <PlayGlyph /> : null}
                    <span>{displayTitle}</span>
                  </span>
                ) : null}
              </span>
            ) : null}
            {showParentLine ? (
              <span
                className={`dash-morph__fade-line dash-morph__parent-line${
                  stackOn ? " is-on" : ""
                }`}
              >
                {displayParentLine}
              </span>
            ) : null}
            {secMount && secHeld ? (
              <span
                className={`dash-morph__fade-line dash-morph__brand-row dash-morph__brand-row--secondary${
                  secOn && stackOn ? " is-on" : ""
                }`}
              >
                {secHeld.icon ? (
                  <span className="dash-morph__icon dash-morph__icon--secondary">
                    <img
                      src={secHeld.icon}
                      alt=""
                      draggable={false}
                      onError={() => setSecondaryIconFailed(true)}
                    />
                  </span>
                ) : null}
                {secHeld.logo ? (
                  <span className="dash-morph__brand dash-morph__brand--secondary">
                    <img
                      src={secHeld.logo}
                      alt=""
                      draggable={false}
                      onError={() => setSecondaryLogoIndex((i) => i + 1)}
                    />
                  </span>
                ) : null}
                {!secHeld.logo && secHeld.text ? (
                  <span className="dash-morph__secondary-title">
                    {secHeld.text}
                  </span>
                ) : null}
              </span>
            ) : null}
            {capMount && capHeld ? (
              <span
                className={`dash-morph__fade-line dash-morph__media-caption${
                  capOn && stackOn ? " is-on" : ""
                }`}
              >
                <PlayGlyph />
                <span>{capHeld}</span>
              </span>
            ) : null}
            {showAction ? (
              <span
                role="link"
                tabIndex={-1}
                className={`dash-morph__fade-line dash-morph__action${
                  stackOn ? " is-on" : ""
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAction?.(e);
                }}
              >
                {sentenceCaseLabel(actionLabel!)}
              </span>
            ) : null}
          </span>
        ) : null}
        {children}
      </span>
    </button>
  );
}
