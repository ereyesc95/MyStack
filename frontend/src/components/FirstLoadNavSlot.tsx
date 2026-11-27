import type { ReactNode } from "react";

/** Slide-down reveal for section/subtab bars — pair with useFirstLoadIntro. */
export default function FirstLoadNavSlot({
  open,
  intro,
  children,
  className = "",
}: {
  open: boolean;
  intro: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`ms-nav-slot${open ? " is-open" : ""}${
        open && intro ? " ms-nav-slot--intro" : ""
      }${className ? ` ${className}` : ""}`}
    >
      <div className="ms-nav-slot-inner">{children}</div>
    </div>
  );
}
