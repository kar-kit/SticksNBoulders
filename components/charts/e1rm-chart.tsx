"use client";

import { chartGeometry, type WeekPoint } from "@/lib/strength/lift";

/**
 * Estimated 1RM over time. One line, no axes clutter.
 *
 * Hand-rolled SVG rather than a charting library. This draws a polyline and a
 * dot: no axes, no legend, no tooltip, no interaction. Every library that could
 * draw it brings a hundred times more than that, and the dependency count in
 * this repo is a deliberate property rather than an accident.
 *
 * The line is spaced by time rather than by index, so a month away from the
 * gym reads as a gap rather than as one more steady step.
 *
 * It scales to its container by drawing into a fixed viewBox and letting the
 * SVG stretch, which keeps the geometry maths independent of the screen.
 */

const WIDTH = 320;
const HEIGHT = 96;

export interface E1rmChartProps {
  points: readonly WeekPoint[];
  /** Named for a screen reader, which cannot read a polyline. */
  label: string;
}

export function E1rmChart({ points, label }: E1rmChartProps) {
  const geometry = chartGeometry(points, WIDTH, HEIGHT);
  if (!geometry) return null;

  const last = geometry.dots[geometry.dots.length - 1];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-24 w-full"
    >
      <path
        d={geometry.path}
        fill="none"
        stroke="var(--accent-fill)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        // The line is drawn into a stretched box, so a plain stroke would be
        // thicker vertically than horizontally. This keeps it even.
        vectorEffect="non-scaling-stroke"
      />
      {/* Only the latest week gets a dot: it is the number in the headline, and
          a dot on every week turns a trend line into a scatter plot. */}
      <circle cx={last.x} cy={last.y} r={3} fill="var(--accent-fill)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
