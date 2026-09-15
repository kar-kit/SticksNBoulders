"use client";

import { bodyweightGeometry, type DayValue } from "@/lib/bodyweight/chart";

/**
 * Daily weigh-ins, with the rolling average over the top.
 *
 * Hand-rolled SVG, like the e1RM chart and for the same reason: this draws two
 * polylines and a dot, and every library that could do it brings a hundred
 * times more than that.
 *
 * The daily line is faint and the average is not. Daily bodyweight is noise
 * around a trend -- the blueprint says the trend is the only part that means
 * anything -- so the eye should land on the smoothed line and read the scatter
 * as texture underneath it.
 */

const WIDTH = 320;
const HEIGHT = 120;

export interface BodyweightChartProps {
  points: readonly DayValue[];
  average: readonly DayValue[];
  label: string;
}

export function BodyweightChart({ points, average, label }: BodyweightChartProps) {
  const geometry = bodyweightGeometry(points, average, WIDTH, HEIGHT);
  // One weigh-in is a number, not a trend. The caller shows the number.
  if (!geometry) return null;

  const last = geometry.average.dots[geometry.average.dots.length - 1] ?? geometry.points.dots[geometry.points.dots.length - 1];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-[120px] w-full"
    >
      <path
        d={geometry.points.path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="text-muted-2"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={geometry.average.path}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-accent-line"
        vectorEffect="non-scaling-stroke"
      />
      {last ? <circle cx={last.x} cy={last.y} r={3} className="fill-accent-line" /> : null}
    </svg>
  );
}
