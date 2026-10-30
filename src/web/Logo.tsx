import { useId } from "react";

// The outline of the cream hand: one shape, with the notch of the thumb cut out.
const HAND =
  "M245 190C310 122 395 50 490 48 585 46 650 95 718 160L800 240C835 270 850 305 835 335 820 362 785 368 755 352L612 272C575 250 535 240 500 248 455 258 410 295 372 335 350 360 345 400 372 422 395 440 432 440 458 418L488 392C502 380 520 372 540 382L790 628C815 652 805 680 785 700L650 820C590 875 410 880 345 815L160 615C100 560 55 505 62 450 68 395 100 345 135 305Z";

// Each finger is a rounded bar centered on (x, y), tilted by `angle`.
const CORAL_FINGERS = [
  { x: 254, y: 596 },
  { x: 346, y: 658 },
  { x: 425, y: 732 },
].map((f) => ({ ...f, angle: -46 }));
const STONE_FINGERS = [
  { x: 578, y: 679 },
  { x: 660, y: 606 },
].map((f) => ({ ...f, angle: 46 }));

const WIRES = [
  "M860 335H1030",
  "M775 568H850C870 568 880 560 893 546L945 494C962 476 975 450 1010 450H1140",
  "M890 608C910 588 935 565 962 565H1045",
];
const DOTS = [
  { cx: 1055, cy: 335, r: 33 },
  { cx: 1175, cy: 447, r: 34 },
  { cx: 1078, cy: 563, r: 32 },
];

const color = (name: string) => `var(--logo-${name})`;

function Stop({
  offset,
  name,
  opacity,
}: {
  offset: number;
  name: string;
  opacity?: number;
}) {
  return (
    <stop
      offset={offset}
      style={{ stopColor: color(name) }}
      stopOpacity={opacity}
    />
  );
}

function Finger({
  x,
  y,
  angle,
  fill,
}: {
  x: number;
  y: number;
  angle: number;
  fill: string;
}) {
  // The wrapping <g> carries the CSS animation, the rect keeps its own placement.
  return (
    <g className="logo-finger">
      <rect
        x={-90}
        y={-38}
        width={178}
        height={76}
        rx={38}
        fill={fill}
        transform={`translate(${x} ${y}) rotate(${angle})`}
      />
    </g>
  );
}

/**
 * The Cockpit mark: a human (coral) and Claude (stone) shaking hands.
 * Still at rest; the animation of styles.css plays when the logo is hovered.
 * Decorative unless a `label` is given (next to the word "Cockpit" it is not needed).
 */
export function Logo({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  // Several logos can share a page: their gradients and clip paths need their own ids.
  const id = useId().replaceAll(":", "");
  const ref = (name: string) => `url(#${id}-${name})`;

  return (
    <svg
      viewBox="-440 30 1872 860"
      className={`logo ${className}`.trim()}
      fill="none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient
          id={`${id}-human`}
          gradientUnits="userSpaceOnUse"
          x1={-380}
          y1={200}
          x2={170}
          y2={690}
        >
          <Stop offset={0} name="coral-soft" />
          <Stop offset={1} name="coral" />
        </linearGradient>
        <radialGradient
          id={`${id}-claude`}
          gradientUnits="userSpaceOnUse"
          cx={760}
          cy={270}
          r={720}
        >
          <Stop offset={0} name="stone-light" />
          <Stop offset={0.55} name="stone" />
          <Stop offset={1} name="stone-deep" />
        </radialGradient>
        <linearGradient
          id={`${id}-hand`}
          gradientUnits="userSpaceOnUse"
          x1={60}
          y1={0}
          x2={580}
          y2={0}
        >
          <Stop offset={0} name="hand-tint" />
          <Stop offset={0.55} name="hand" />
          <Stop offset={1} name="hand" />
        </linearGradient>
        <radialGradient
          id={`${id}-warm`}
          gradientUnits="userSpaceOnUse"
          cx={120}
          cy={640}
          r={330}
        >
          <Stop offset={0} name="coral" opacity={0.45} />
          <Stop offset={1} name="coral" opacity={0} />
        </radialGradient>
        <linearGradient id={`${id}-coral-finger`} x1={0} y1={1} x2={1} y2={0}>
          <Stop offset={0} name="coral" />
          <Stop offset={1} name="coral-soft" />
        </linearGradient>
        <linearGradient id={`${id}-stone-finger`} x1={0} y1={0} x2={1} y2={1}>
          <Stop offset={0} name="finger" />
          <Stop offset={1} name="stone-deep" />
        </linearGradient>
        <linearGradient
          id={`${id}-wire`}
          gradientUnits="userSpaceOnUse"
          x1={770}
          y1={0}
          x2={1060}
          y2={0}
        >
          <Stop offset={0} name="wire" opacity={0} />
          <Stop offset={0.45} name="wire" opacity={0.85} />
          <Stop offset={1} name="wire" />
        </linearGradient>
        <clipPath id={`${id}-hand-clip`}>
          <path d={HAND} />
        </clipPath>
      </defs>

      <rect
        className="logo-human"
        x={-416}
        y={194}
        width={900}
        height={490}
        rx={245}
        fill={ref("human")}
      />

      <g className="logo-claude">
        <rect
          x={300}
          y={194}
          width={1108}
          height={490}
          rx={245}
          fill={ref("claude")}
        />
        <g stroke={ref("wire")} strokeWidth={14} strokeLinecap="round">
          {WIRES.map((d) => (
            <path key={d} className="logo-wire" d={d} pathLength={1} />
          ))}
        </g>
        <g style={{ fill: color("wire") }}>
          {DOTS.map((dot) => (
            <circle key={dot.cx} className="logo-dot" {...dot} />
          ))}
        </g>
      </g>

      <g className="logo-hand">
        <path d={HAND} fill={ref("hand")} />
        <rect
          x={-100}
          y={300}
          width={700}
          height={600}
          fill={ref("warm")}
          clipPath={ref("hand-clip")}
        />
        <g>
          {CORAL_FINGERS.map((f) => (
            <Finger key={f.x} {...f} fill={ref("coral-finger")} />
          ))}
        </g>
        <g>
          {STONE_FINGERS.map((f) => (
            <Finger key={f.x} {...f} fill={ref("stone-finger")} />
          ))}
        </g>
      </g>
    </svg>
  );
}
