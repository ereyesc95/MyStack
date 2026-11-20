import {
  MYSTACK_BOTTOM_PATH,
  MYSTACK_COMPACT_STROKE,
  MYSTACK_MIDDLE_PATH,
  MYSTACK_TOP_HOLE_INSET,
  MYSTACK_TOP_HOLE_INSET_COMPACT,
  MYSTACK_TOP_HOLE_PATH,
  MYSTACK_TOP_PATH,
  MYSTACK_TRANSFORM,
  MYSTACK_VIEW_BOX,
  mystackTopHoleTransform,
} from "../mystackMark";

type Props = {
  className?: string;
  size?: number;
};

/**
 * MyStack mark from assets/icons/MyStack.svg.
 * Top diamond + bottom = currentColor / --mystack-frame; triangle + middle = --mystack-core / accent.
 * Compact sizes (<20) use a tighter hole inset + slight stroke fattening.
 */
export default function MyStackIcon({ className, size = 16 }: Props) {
  const compact = size < 20;
  const holeTransform = mystackTopHoleTransform(
    compact ? MYSTACK_TOP_HOLE_INSET_COMPACT : MYSTACK_TOP_HOLE_INSET
  );
  const coreFill = "var(--mystack-core, var(--accent))";
  const frameFill = "currentColor";
  const fatten = compact
    ? {
        strokeWidth: MYSTACK_COMPACT_STROKE,
        paintOrder: "stroke fill" as const,
      }
    : null;

  return (
    <svg
      className={className}
      viewBox={MYSTACK_VIEW_BOX}
      width={size}
      height={size}
      aria-hidden
      fill="none"
    >
      <g transform={MYSTACK_TRANSFORM}>
        <path
          className="mystack-icon__accent"
          fill={coreFill}
          stroke={compact ? coreFill : undefined}
          {...(fatten ?? {})}
          transform={holeTransform}
          d={MYSTACK_TOP_HOLE_PATH}
        />
        <path
          className="mystack-icon__body"
          fill={frameFill}
          stroke={compact ? frameFill : undefined}
          {...(fatten ?? {})}
          d={MYSTACK_TOP_PATH}
        />
        <path
          className="mystack-icon__accent"
          fill={coreFill}
          stroke={compact ? coreFill : undefined}
          {...(fatten ?? {})}
          d={MYSTACK_MIDDLE_PATH}
        />
        <path
          className="mystack-icon__body"
          fill={frameFill}
          stroke={compact ? frameFill : undefined}
          {...(fatten ?? {})}
          d={MYSTACK_BOTTOM_PATH}
        />
      </g>
    </svg>
  );
}
