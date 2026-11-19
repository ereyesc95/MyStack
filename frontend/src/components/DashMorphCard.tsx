import type { MouseEvent, ReactNode } from "react";

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
  iconUrl?: string | null;
  /** Country ISO for left circle flag when expanded / idle fill. */
  flagIso?: string | null;
  /** When true with a brand mark, also show title above a smaller logo. */
  titleOverBrand?: boolean;
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

export default function DashMorphCard({
  id,
  title,
  shape,
  coverUrl,
  bannerUrl,
  landscapeUrl,
  logoUrl,
  iconUrl,
  flagIso,
  titleOverBrand = false,
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
  const brand = logoUrl || iconUrl || null;
  const isFlag = Boolean(flagIso) || shape === "flag";
  const showFlagBadge = expanded && Boolean(flagIso);
  const showBrand = expanded && !showFlagBadge && Boolean(brand);
  const showTitleAlone =
    expanded && !showFlagBadge && !brand && Boolean(title);
  const showTitleOverBrand =
    expanded && titleOverBrand && showBrand && Boolean(title);

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
          <span className="dash-morph__flag-badge" aria-hidden>
            <span className={`fi fi-${flagIso}`} />
          </span>
        ) : null}
        {showTitleOverBrand ? (
          <span className="dash-morph__brand-stack">
            <span className="dash-morph__title dash-morph__title--over-brand">
              {title}
            </span>
            <span className="dash-morph__brand dash-morph__brand--small">
              <img src={brand!} alt="" draggable={false} />
            </span>
          </span>
        ) : null}
        {showBrand && !showTitleOverBrand ? (
          <span className="dash-morph__brand">
            <img src={brand!} alt="" draggable={false} />
          </span>
        ) : null}
        {showTitleAlone ? (
          <span className="dash-morph__title">{title}</span>
        ) : null}
        {children}
      </span>
    </button>
  );
}
