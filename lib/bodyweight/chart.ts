import { dayDate } from "./bodyweight";

/**
 * Geometry for the bodyweight chart: daily points and the rolling average, on
 * one shared scale.
 *
 * Its own function rather than a generalisation of `chartGeometry` in
 * lib/strength/lift.ts. That one is typed to a `WeekPoint` and draws a single
 * series; widening it to carry two would change a shipped chart to serve a new
 * one, and the maths is twenty lines.
 *
 * **Both series map through the same min and max.** That is the whole reason
 * this is one function rather than two calls: scaled independently, the average
 * line drifts away from the points it is averaging, and the result looks like a
 * data bug rather than a rendering one.
 *
 * Spaced by time, not by index, so a fortnight away from the scales reads as a
 * gap rather than as one more evenly spaced step.
 */

export interface DayValue {
  measuredOn: string;
  kg: number;
}

export interface ChartSeries {
  path: string;
  dots: { x: number; y: number; value: DayValue }[];
}

export interface BodyweightGeometry {
  points: ChartSeries;
  average: ChartSeries;
  minKg: number;
  maxKg: number;
}

const plottable = (values: readonly DayValue[]) =>
  values.filter((value) => dayDate(value.measuredOn) !== null && Number.isFinite(value.kg));

export function bodyweightGeometry(
  points: readonly DayValue[],
  average: readonly DayValue[],
  width: number,
  height: number,
  padding = 4,
): BodyweightGeometry | null {
  const daily = plottable(points);
  // One weigh-in is a number, not a trend. The screen shows the number and
  // hides the chart rather than drawing a single dot in an empty box.
  if (daily.length < 2) return null;

  const smoothed = plottable(average);

  // The scale spans BOTH series. An average can sit outside the visible daily
  // points -- it is pulled by weights from before the window -- and clipping it
  // to the points' range would bend the line at the edge of the chart.
  const everyKg = [...daily, ...smoothed].map((value) => value.kg);
  const everyTime = daily.map((value) => dayDate(value.measuredOn)!.getTime());

  const minKg = Math.min(...everyKg);
  const maxKg = Math.max(...everyKg);
  const minTime = Math.min(...everyTime);
  const maxTime = Math.max(...everyTime);

  const spanTime = maxTime - minTime || 1;
  // A flat run sits in the middle of the box rather than on its floor, which
  // is what a zero span would otherwise produce.
  const spanKg = maxKg - minKg || 1;
  const inner = { w: width - padding * 2, h: height - padding * 2 };

  const project = (values: readonly DayValue[]): ChartSeries => {
    const dots = values.map((value) => ({
      x: padding + ((dayDate(value.measuredOn)!.getTime() - minTime) / spanTime) * inner.w,
      y:
        maxKg === minKg
          ? padding + inner.h / 2
          : padding + inner.h - ((value.kg - minKg) / spanKg) * inner.h,
      value,
    }));
    const path = dots
      .map((dot, at) => `${at === 0 ? "M" : "L"}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`)
      .join(" ");
    return { path, dots };
  };

  return { points: project(daily), average: project(smoothed), minKg, maxKg };
}
