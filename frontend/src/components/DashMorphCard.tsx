import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

export type DashMorphShape =
  | "square"
  | "circle"
  | "landscape"
  | "portrait"
  | "flag";

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
  onEnter: (id: string) => void;
  onLeave: () => void;
  onActivate: (e: MouseEvent<HTMLElement>) => void;
  children?: ReactNode;
};

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
  flagIso,
  titleOverBrand = false,
  actionLabel = null,
  onAction,
  expanded,
  revealed = false,
  className = "",
  active = false,
  onEnter,
  onLeave,
  onActivate,
  children,
}: Props) {
  const idleBg = coverUrl || landscapeUrl || bannerUrl || null;
  const expandedBg = pickExpandedBg(bannerUrl, landscapeUrl, coverUrl);
  const primaryLogoOptions = logoCandidates(logoUrl, logoCollapsedUrl);
  const secondaryLogoOptions = logoCandidates(
    secondaryLogoUrl,
    secondaryLogoCollapsedUrl
  );
  const companionIconUrl = cleanUrl(iconUrl);
  const secondaryCompanionIconUrl = cleanUrl(secondaryIconUrl);

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
  const showSecondaryLogo =
    expanded && !showFlagBadge && Boolean(secondaryLogoMark);
  const showSecondaryText =
    expanded &&
    !showFlagBadge &&
    !secondaryLogoMark &&
    Boolean(secondaryTitle);
  const showSecondaryIcon =
    expanded &&
    !showFlagBadge &&
    Boolean(secondaryCompanionIcon) &&
    (showSecondaryLogo || showSecondaryText);
  const showAction =
    expanded && !showFlagBadge && Boolean(actionLabel) && Boolean(onAction);
  const showStack =
    showTitleOver ||
    showTitleAlone ||
    showPrimaryLogo ||
    showPrimaryIcon ||
    showSecondaryLogo ||
    showSecondaryText ||
    showSecondaryIcon ||
    showAction;

  const primaryRow =
    showPrimaryIcon || showPrimaryLogo || (showTitleAlone && !showTitleOver);
  const secondaryRow =
    showSecondaryIcon || showSecondaryLogo || showSecondaryText;

  return (
    <button
      type="button"
      data-dash-card={id}
      className={[
        "dash-morph",
        `dash-morph--${shape}`,
        isFlag ? "dash-morph--has-flag" : "",
        expanded ? "is-expanded" : "",
        revealed ? "is-revealed" : "",
        active ? "active" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={() => onEnter(id)}
      onMouseLeave={onLeave}
      onFocus={() => onEnter(id)}
      onBlur={onLeave}
      onClick={onActivate}
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
          <span className="dash-morph__flag-row">
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
          <span className="dash-morph__brand-stack">
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
                      titleOverBrand || secondaryRow || showAction
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
                    {secondaryTitle}
                  </span>
                ) : null}
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
