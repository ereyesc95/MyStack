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
  coverUrl?: string | null
): string | null {
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
  const [previewOverlay, setPreviewOverlay] =
    useState<DashPreviewOverlay>(EMPTY_OVERLAY);
  const onOverlay = useCallback((s: DashPreviewOverlay) => {
    setPreviewOverlay(s);
  }, []);

  const previewArmed = Boolean(
    preview && (expanded || revealed)
  );
  const previewActive = previewOverlay.active;

  const idleBg = coverUrl || landscapeUrl || bannerUrl || null;
  const expandedBg = pickExpandedBg(bannerUrl, landscapeUrl, coverUrl);
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
  const effectiveSecondaryTitle = usePreviewArtist
    ? previewOverlay.artistName
    : secondaryTitle;

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

  const showTitleOver =
    expanded &&
    !showFlagBadge &&
    titleOverBrand &&
    Boolean(title) &&
    Boolean(logoMark);
  const showTitleAlone =
    expanded && !showFlagBadge && !logoMark && Boolean(title);
  const showPrimaryLogo = expanded && !showFlagBadge && Boolean(logoMark);
  const showPrimaryIcon =
    expanded &&
    !showFlagBadge &&
    Boolean(companionIcon) &&
    (showPrimaryLogo || showTitleAlone || showTitleOver);
  const showParentLine =
    expanded && !showFlagBadge && Boolean(parentLine);
  // Origins (flag): still show preview artist + media lines under the flag title.
  const showSecondaryLogo =
    expanded &&
    (!showFlagBadge || previewActive) &&
    Boolean(secondaryLogoMark);
  const showSecondaryText =
    expanded &&
    (!showFlagBadge || previewActive) &&
    !secondaryLogoMark &&
    Boolean(effectiveSecondaryTitle);
  const showSecondaryIcon =
    expanded &&
    (!showFlagBadge || previewActive) &&
    Boolean(secondaryCompanionIcon) &&
    (showSecondaryLogo || showSecondaryText);
  const showMediaCaption =
    expanded &&
    previewActive &&
    Boolean(preview?.showMediaCaption) &&
    Boolean(previewOverlay.mediaTitle);
  const showAction =
    expanded && !showFlagBadge && Boolean(actionLabel) && Boolean(onAction);
  const showStack =
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

  const handleActivate = (e: MouseEvent<HTMLElement>) => {
    // Navigate cancels preview via leave/unmount; end immediately.
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
        {preview && previewArmed ? (
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
              showStack ? " dash-morph__flag-row--with-stack" : ""
            }`}
          >
            <span className="dash-morph__flag-badge" aria-hidden>
              <span className={`fi fi-${flagIso}`} />
            </span>
            {title ? (
              <span className="dash-morph__title dash-morph__title--flag">
                {title}
              </span>
            ) : null}
          </span>
        ) : null}
        {showStack ? (
          <span
            className={`dash-morph__brand-stack${
              showFlagBadge ? " dash-morph__brand-stack--under-flag" : ""
            }`}
          >
            {showTitleOver ? (
              <span className="dash-morph__title dash-morph__title--over-brand">
                {title}
              </span>
            ) : null}
            {primaryRow ? (
              <span className="dash-morph__brand-row">
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
                  <span className="dash-morph__title dash-morph__title--inline">
                    {title}
                  </span>
                ) : null}
              </span>
            ) : null}
            {showParentLine ? (
              <span className="dash-morph__parent-line">{parentLine}</span>
            ) : null}
            {secondaryRow ? (
              <span className="dash-morph__brand-row dash-morph__brand-row--secondary">
                {showSecondaryIcon ? (
                  <span className="dash-morph__icon dash-morph__icon--secondary">
                    <img
                      src={secondaryCompanionIcon!}
                      alt=""
                      draggable={false}
                      onError={() => setSecondaryIconFailed(true)}
                    />
                  </span>
                ) : null}
                {showSecondaryLogo ? (
                  <span className="dash-morph__brand dash-morph__brand--secondary">
                    <img
                      src={secondaryLogoMark!}
                      alt=""
                      draggable={false}
                      onError={() => setSecondaryLogoIndex((i) => i + 1)}
                    />
                  </span>
                ) : null}
                {showSecondaryText ? (
                  <span className="dash-morph__secondary-title">
                    {effectiveSecondaryTitle}
                  </span>
                ) : null}
              </span>
            ) : null}
            {showMediaCaption ? (
              <span className="dash-morph__media-caption">
                <PlayGlyph />
                <span>{previewOverlay.mediaTitle}</span>
              </span>
            ) : null}
            {showAction ? (
              <span
                role="link"
                tabIndex={-1}
                className="dash-morph__action"
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
