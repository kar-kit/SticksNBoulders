import { rowId } from "@/lib/programming/program";

/**
 * Which overlay the Athlete View has open, held in the URL.
 *
 * Two things on the dashboard open over it rather than in place: the
 * bodyweight view behind the header figure, and a clip with its thread. Both
 * live in the query string -- `?view=bodyweight`, `?clip=<setId>` -- so the
 * browser's Back closes them the way a coach expects, a reload keeps them
 * open, and a link to one can be pasted to the other coach at the gym.
 *
 * A dialog over the page rather than a sub-route, so closing it puts the
 * coach back exactly where they were scrolled, with every panel still loaded
 * -- a sub-route would re-read all of them on the way back.
 *
 * Pure: reading and writing the query string. The history calls are in
 * components/coach/use-athlete-panel.ts.
 */

export type AthletePanel = { kind: "bodyweight" } | { kind: "clip"; clipId: string };

/** The panel a query string asks for. A clip id that is not a plausible row id is ignored, not trusted. */
export function readPanel(params: Pick<URLSearchParams, "get">): AthletePanel | null {
  if (params.get("view") === "bodyweight") return { kind: "bodyweight" };
  const clip = params.get("clip");
  if (clip && rowId.safeParse(clip).success) return { kind: "clip", clipId: clip };
  return null;
}

/**
 * The query string with `panel` open, or with none when it is null. Anything
 * else already in it is kept, so this never eats a parameter another feature
 * put there.
 */
export function panelSearch(current: string, panel: AthletePanel | null): string {
  const params = new URLSearchParams(current);
  params.delete("view");
  params.delete("clip");
  if (panel?.kind === "bodyweight") params.set("view", "bodyweight");
  if (panel?.kind === "clip") params.set("clip", panel.clipId);
  const search = params.toString();
  return search ? `?${search}` : "";
}
