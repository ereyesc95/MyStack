import type { ReactNode } from "react";

export type DashPaneIconKind =
  | "repeat"
  | "disc"
  | "heart"
  | "globe"
  | "star"
  | "book"
  | "saga"
  | "planet"
  | "controller";

type IconProps = { className?: string };

function IconRepeat({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"
      />
    </svg>
  );
}

function IconDisc({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 14.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"
      />
    </svg>
  );
}

function IconHeart({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
      />
    </svg>
  );
}

function IconGlobe({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
      />
    </svg>
  );
}

function IconStar({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27z"
      />
    </svg>
  );
}

function IconBook({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M21 4H13c-.55 0-1 .45-1 1v14.5c0 .28.22.5.5.5H20c.55 0 1-.45 1-1V5c0-.55-.45-1-1-1zm-1 13.5h-6V6h6v11.5zM11 4H3c-.55 0-1 .45-1 1v13.5c0 .55.45 1 1 1h7.5c.28 0 .5-.22.5-.5V5c0-.55-.45-1-1-1zm-1 13.5H4V6h6v11.5z"
      />
    </svg>
  );
}

function IconPlanet({ className }: IconProps) {
  /* Galaxy / spiral mark for Universes */
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2c1.2 3.8 4.2 6.8 8 8-3.8 1.2-6.8 4.2-8 8-1.2-3.8-4.2-6.8-8-8 3.8-1.2 6.8-4.2 8-8zm0 5.2c-.7 1.9-2.1 3.3-4 4 1.9.7 3.3 2.1 4 4 .7-1.9 2.1-3.3 4-4-1.9-.7-3.3-2.1-4-4z"
      />
      <circle cx="5.2" cy="5.2" r="1.1" fill="currentColor" />
      <circle cx="18.5" cy="6.5" r="0.85" fill="currentColor" />
      <circle cx="17.2" cy="17.8" r="1" fill="currentColor" />
      <circle cx="6.5" cy="18.2" r="0.75" fill="currentColor" />
    </svg>
  );
}

function IconSaga({ className }: IconProps) {
  /* Linked chapters / saga arc — cleaner than a book for franchise rows */
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M4.5 5.25h9.25c.41 0 .75.34.75.75v11.5c0 .55-.45 1-1 1H4.5c-.55 0-1-.45-1-1V6c0-.41.34-.75.75-.75zm1.25 1.5v10h7.5v-10h-7.5zm11.1-.35 3.4 1.05c.5.15.78.7.62 1.2l-2.55 8.35c-.16.5-.7.78-1.2.62l-2.05-.63.7-2.28 1.05.32 1.85-6.05-1.85-.57.63-2.01z"
      />
    </svg>
  );
}

function IconController({ className }: IconProps) {
  /* Classic gamepad — D-pad + face buttons */
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M17 6H7C4.24 6 2 8.24 2 11v2c0 2.76 2.24 5 5 5h1.35l.72 1.45c.2.4.59.65 1.03.65h3.8c.44 0 .83-.25 1.03-.65L15.65 18H17c2.76 0 5-2.24 5-5v-2c0-2.76-2.24-5-5-5zM8.5 14.25H7.25v1.25h-1.5V14.25H4.5v-1.5h1.25V11.5h1.5v1.25H8.5v1.5zM14.9 13.9a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2zm2.55 1.85a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2zm0-3.7a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2zm2.55 1.85a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2z"
      />
    </svg>
  );
}

const ICONS: Record<DashPaneIconKind, (p: IconProps) => ReactNode> = {
  repeat: IconRepeat,
  disc: IconDisc,
  heart: IconHeart,
  globe: IconGlobe,
  star: IconStar,
  book: IconBook,
  saga: IconSaga,
  planet: IconPlanet,
  controller: IconController,
};

type Props = {
  icon: DashPaneIconKind;
  title: string;
  subtitle: string;
};

export default function DashPaneLabel({ icon, title, subtitle }: Props) {
  const Icon = ICONS[icon];
  return (
    <div className="dash-row-label">
      <span className="dash-pane-logo dash-pane-logo--icon" aria-hidden>
        <Icon className="dash-pane-logo__svg" />
      </span>
      <div className="dash-row-label-text">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}
