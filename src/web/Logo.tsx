// The Cockpit mark, the loop (decision 046): four arcs, one per beat (idea, you, Claude,
// done), each swelling from a thin tail to a round head, around a small core.
// Angles run clockwise from the top; the centre line of an arc sits at radius 40.
const point = (angle: number, r: number) => {
  const a = (angle * Math.PI) / 180;
  return `${(60 + r * Math.sin(a)).toFixed(2)} ${(60 - r * Math.cos(a)).toFixed(2)}`;
};

// One closed path: the outer edge forward, a round head, the inner edge back, a round tail.
function arc(i: number) {
  const steps = 40;
  const edge = (side: 1 | -1, k: number) => {
    const t = k / steps;
    return point(90 * i + 10 + 62 * t, 40 + (side * (7 + 15 * t ** 0.8)) / 2);
  };
  const ks = Array.from({ length: steps + 1 }, (_, k) => k);
  return [
    `M${ks.map((k) => edge(1, k)).join("L")}`,
    `A11 11 0 0 1 ${edge(-1, steps)}`,
    `L${ks
      .reverse()
      .map((k) => edge(-1, k))
      .join("L")}`,
    `A3.5 3.5 0 0 1 ${edge(1, 0)}Z`,
  ].join("");
}

const ARCS = [
  { fill: "var(--logo-idea)", d: arc(0) },
  { fill: "var(--logo-you)", d: arc(1) },
  { fill: "var(--logo-claude)", d: arc(2) },
  { fill: "var(--logo-done)", d: arc(3) },
];

/**
 * The Cockpit mark: the loop. Still at rest; the vortex of styles.css plays when it is hovered.
 * Decorative unless a `label` is given (next to the word "Cockpit" it is not needed).
 */
export function Logo({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={`logo ${className}`.trim()}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g className="logo-loop">
        {ARCS.map(({ fill, d }) => (
          <path key={fill} className="logo-arc" fill={fill} d={d} />
        ))}
      </g>
      <circle
        className="logo-core"
        cx={60}
        cy={60}
        r={7}
        fill="var(--color-foreground)"
      />
    </svg>
  );
}
