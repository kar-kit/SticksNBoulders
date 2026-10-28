/**
 * The landing hero, as geometry: the logo's stick and boulder, a barbell and
 * stone plates, a platform, a rack and a bench, all low-poly and flat-shaded.
 *
 * Pure. `heroFrame(pose)` returns flat polygons in screen space, and two
 * renderers draw them: the server's SVG poster (`components/landing/
 * hero-poster.tsx`) and the canvas loop (`components/landing/hero-canvas.ts`).
 * Both read the same function, so the poster is exactly the canvas's first
 * and last frame and swapping one for the other moves nothing. What happens
 * when is `momentAt` in lib/landing/hero-mode.ts; this file only draws a pose.
 *
 * Software 3D on purpose. The scene is a few hundred flat triangles with one
 * light, which needs a depth sort and a fill, not a GPU pipeline: three.js
 * would cost ~150 KB gzipped for what is a few KB here, and Canvas 2D runs on
 * every device that has no WebGL. docs/landing-page.md has the comparison.
 */

import { FINAL_POSE, PLATE_RADIUS, type Pose } from "./hero-mode";

export { FINAL_POSE, type Pose };

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

type RGB = readonly [number, number, number];

/** One filled polygon, already projected. Points are x,y pairs in CSS pixels. */
export interface Poly {
  points: number[];
  fill: string;
  stroke: string | null;
  opacity: number;
}

interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

interface Solid {
  tris: Tri[];
  centre: Vec3;
  colour: RGB;
  opacity?: number;
}

/* --- Palette ----------------------------------------------------------- */

/*
 * Lit-face colours from SNB.png, not from globals.css: the logo's copper
 * stick is lighter than --accent-fill because it is a lit surface, and its
 * shaded faces fall to the logo's dark brown. Same for the stone. Everything
 * that is equipment rather than the logo (platform, rack, bench) is kept dark
 * so the bar and plates carry the picture.
 */
const COPPER: RGB = [236, 180, 126];
const STONE: RGB = [204, 203, 209];
const RUBBER: RGB = [64, 63, 70];
const WOOD: RGB = [100, 79, 60];
const STEEL: RGB = [112, 111, 120];
const PAD: RGB = [120, 114, 126];
/** Faces turned fully away from the light keep this much of their colour. */
const AMBIENT = 0.3;

/* --- Small vector maths ------------------------------------------------ */

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (p: Vec3, q: Vec3): Vec3 => v(p.x + q.x, p.y + q.y, p.z + q.z);
const sub = (p: Vec3, q: Vec3): Vec3 => v(p.x - q.x, p.y - q.y, p.z - q.z);
const scale = (p: Vec3, k: number): Vec3 => v(p.x * k, p.y * k, p.z * k);
const dot = (p: Vec3, q: Vec3): number => p.x * q.x + p.y * q.y + p.z * q.z;
const cross = (p: Vec3, q: Vec3): Vec3 => v(p.y * q.z - p.z * q.y, p.z * q.x - p.x * q.z, p.x * q.y - p.y * q.x);
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const lerp3 = (p: Vec3, q: Vec3, k: number): Vec3 => v(lerp(p.x, q.x, k), lerp(p.y, q.y, k), lerp(p.z, q.z, k));

function normalise(p: Vec3): Vec3 {
  const length = Math.hypot(p.x, p.y, p.z) || 1;
  return scale(p, 1 / length);
}

/** Up and to the left, as on the logo. */
const LIGHT = normalise(v(-0.5, 0.75, 0.6));
/** A weak second light from the camera's side, so a plate's face is never a flat dark disc. */
const FILL = normalise(v(0.7, 0.15, 0.7));
const FILL_STRENGTH = 0.28;

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number): number => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
/** 0 before `from`, 1 after `to`, smooth between. */
const phase = (t: number, from: number, to: number): number => smooth((t - from) / (to - from));

/** Mulberry32. Seeded, so the server's poster and the browser's canvas agree. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* --- Shapes -------------------------------------------------------------- */

/** Points every triangle's winding outward from `centre`, so culling can trust it. */
function outward(tris: Tri[], centre: Vec3): Tri[] {
  return tris.map((tri) => {
    const n = cross(sub(tri.b, tri.a), sub(tri.c, tri.a));
    const mid = scale(add(add(tri.a, tri.b), tri.c), 1 / 3);
    return dot(n, sub(mid, centre)) < 0 ? { a: tri.a, b: tri.c, c: tri.b } : tri;
  });
}

const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Tri[] => [{ a, b, c }, { a, b: c, c: d }];

/** An axis-aligned box. `faces` drops sides nobody will see, or that touch a neighbour. */
function box(min: Vec3, max: Vec3, faces = "tbfkle"): Tri[] {
  const [x0, y0, z0] = [min.x, min.y, min.z];
  const [x1, y1, z1] = [max.x, max.y, max.z];
  const tris: Tri[] = [];
  if (faces.includes("t")) tris.push(...quad(v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1)));
  if (faces.includes("b")) tris.push(...quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)));
  if (faces.includes("f")) tris.push(...quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)));
  if (faces.includes("k")) tris.push(...quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0)));
  if (faces.includes("l")) tris.push(...quad(v(x0, y0, z0), v(x0, y1, z0), v(x0, y1, z1), v(x0, y0, z1)));
  if (faces.includes("e")) tris.push(...quad(v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)));
  return outward(tris, scale(add(min, max), 0.5));
}

/**
 * A faceted stick from `a` to `b`, with a kink ring part way along so it reads
 * as split wood rather than a pencil. The logo's fork is one of these.
 */
function stick(a: Vec3, b: Vec3, radius: number, sides: number, rng: () => number): Tri[] {
  const axis = normalise(sub(b, a));
  const helper = Math.abs(axis.y) > 0.9 ? v(1, 0, 0) : v(0, 1, 0);
  const u = normalise(cross(axis, helper));
  const w = cross(axis, u);
  const turn = rng() * Math.PI * 2;
  const ring = (centre: Vec3, r: number): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const angle = turn + (i / sides) * Math.PI * 2;
      const k = r * (1 + (rng() - 0.5) * 0.18);
      return add(centre, add(scale(u, Math.cos(angle) * k), scale(w, Math.sin(angle) * k)));
    });
  const rings = [ring(a, radius * 0.92), ring(lerp3(a, b, 0.5), radius * 1.06), ring(b, radius * 0.8)];
  const tris: Tri[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      tris.push({ a: rings[r][i], b: rings[r][j], c: rings[r + 1][j] });
      tris.push({ a: rings[r][i], b: rings[r + 1][j], c: rings[r + 1][i] });
    }
  }
  for (const cap of [rings[0], rings[rings.length - 1]]) {
    for (let i = 1; i < sides - 1; i++) tris.push({ a: cap[0], b: cap[i], c: cap[i + 1] });
  }
  return outward(tris, lerp3(a, b, 0.5));
}

/**
 * Rock: an icosahedron split once (80 faces), pushed about, centred on the
 * origin and scaled per axis. The logo's boulder and every plate are this.
 */
function rock(rng: () => number, size: Vec3, roughness: number): Tri[] {
  const g = (1 + Math.sqrt(5)) / 2;
  const base = [
    v(-1, g, 0), v(1, g, 0), v(-1, -g, 0), v(1, -g, 0),
    v(0, -1, g), v(0, 1, g), v(0, -1, -g), v(0, 1, -g),
    v(g, 0, -1), v(g, 0, 1), v(-g, 0, -1), v(-g, 0, 1),
  ].map(normalise);
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  // Shared midpoints get one displacement each, so the surface stays closed.
  const points = [...base];
  const midpoints = new Map<string, number>();
  const mid = (i: number, j: number): number => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    const known = midpoints.get(key);
    if (known !== undefined) return known;
    points.push(normalise(scale(add(points[i], points[j]), 0.5)));
    midpoints.set(key, points.length - 1);
    return points.length - 1;
  };
  const split: number[][] = [];
  for (const [a, b, c] of faces) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    split.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  const placed = points.map((p) => {
    const k = 1 - roughness / 2 + rng() * roughness;
    return v(p.x * size.x * k, p.y * size.y * k, p.z * size.z * k);
  });
  return outward(
    split.map(([a, b, c]) => ({ a: placed[a], b: placed[b], c: placed[c] })),
    v(0, 0, 0),
  );
}

/* --- Dimensions -------------------------------------------------------- */

// PLATE_RADIUS comes from hero-mode: the timeline needs it for the bar's
// floor height. Every plate is the same size, as on a competition bar.
const PLATE_HALF_WIDTH = 0.11;
/** Where the sleeve starts and the first plate sits against the collar. */
const COLLAR_X = 1.22;
export const MAX_PLATES = 4;
const BAR_SIDES = 6;
const SHAFT_RADIUS = 0.07;
const SLEEVE_RADIUS = 0.1;
const BAR_HALF = COLLAR_X + MAX_PLATES * PLATE_HALF_WIDTH * 2 + 0.22;

/** The logo: where the stick leans and where the boulder sits. */
const BOULDER_CENTRE = v(0.62, 0.6, -0.3);
const BOULDER_SIZE = v(1.12, 0.9, 1.0);
const STICK_FOOT = v(-1.25, 0.04, 0.5);
const STICK_ANGLE = 0.78;
const STICK_LENGTH = 2.65;
const STICK_RADIUS = 0.15;

/** Rack uprights, a little behind the bar. */
const UPRIGHT_X = 1.0;
const UPRIGHT_Z = -0.24;
const UPRIGHT_HALF = 0.06;

/* --- The scene's fixed parts, built once ------------------------------- */

interface Parts {
  boulder: Tri[];
  plates: Tri[][];
  /** Per bar ring vertex, a fixed radius wobble: the low-poly look, held still. */
  barJitter: number[];
  fork: Tri[];
}

function buildParts(): Parts {
  const rng = random(0x5b0b);
  return {
    boulder: rock(rng, BOULDER_SIZE, 0.17),
    plates: Array.from({ length: MAX_PLATES * 2 }, () =>
      rock(rng, v(PLATE_HALF_WIDTH * 1.05, PLATE_RADIUS, PLATE_RADIUS), 0.14),
    ),
    barJitter: Array.from({ length: 32 * BAR_SIDES }, () => 1 + (rng() - 0.5) * 0.16),
    // The logo's fork, in the stick's own frame: x along the stick, from its foot.
    fork: stick(
      v(STICK_LENGTH * 0.66, 0, 0),
      v(STICK_LENGTH * 0.66 + Math.cos(0.62) * STICK_LENGTH * 0.3, Math.sin(0.62) * STICK_LENGTH * 0.3, 0),
      STICK_RADIUS * 0.72,
      5,
      rng,
    ),
  };
}

let built: Parts | null = null;
const parts = (): Parts => (built ??= buildParts());

const transform = (tris: Tri[], f: (p: Vec3) => Vec3): Tri[] => tris.map((t) => ({ a: f(t.a), b: f(t.b), c: f(t.c) }));

/* --- Posing ------------------------------------------------------------ */

/** Where plate `slot` (0 at the collar) sits along the bar on one side. */
const slotX = (slot: number): number => COLLAR_X + PLATE_HALF_WIDTH * (2 * slot + 1);

/** The bar's axis, morphing from the logo's leaning stick (form 0) to a level barbell (form 1). */
function barFrame(pose: Pose) {
  const f = smooth(pose.form);
  const stickDir = v(Math.cos(STICK_ANGLE), Math.sin(STICK_ANGLE), 0);
  const stickMid = add(STICK_FOOT, scale(stickDir, STICK_LENGTH / 2));
  const barMid = v(0, pose.barY, pose.barZ);
  const half = lerp(STICK_LENGTH / 2, BAR_HALF, f);
  const axis = normalise(lerp3(stickDir, v(1, 0, 0), f));
  const centre = lerp3(stickMid, barMid, f);
  /** A point on the bar at distance `x` from its middle, with the bend applied. */
  const at = (x: number): Vec3 => {
    const sag = pose.bend * (1 - (x / slotX(0)) ** 2) * f;
    return add(add(centre, scale(axis, x)), v(0, sag, 0));
  };
  return { f, half, axis, at };
}

function barSolids(pose: Pose): Solid[] {
  const { barJitter } = parts();
  const { f, half, axis, at } = barFrame(pose);
  const shaft = lerp(STICK_RADIUS, SHAFT_RADIUS, f);
  const sleeve = lerp(STICK_RADIUS * 0.9, SLEEVE_RADIUS, f);
  const inside = (x: number) => Math.min(x, half - 0.02);

  // Rings along the bar. The pieces between them are drawn as separate solids
  // so each can be depth-sorted against the plate or upright it passes.
  const plateEdges = Array.from({ length: MAX_PLATES + 1 }, (_, k) => COLLAR_X + k * PLATE_HALF_WIDTH * 2);
  const right: [number, number][] = [
    [0.86, shaft], [COLLAR_X - 0.03, shaft],
    ...plateEdges.map((x): [number, number] => [inside(x), sleeve]),
    [half, sleeve * 0.9],
  ];
  const stations: [number, number][] = [
    ...right.map(([x, r]): [number, number] => [-x, r]).reverse(),
    [0, shaft],
    ...right,
  ];
  const u = normalise(v(-axis.y, axis.x, 0));
  const w = v(0, 0, 1);
  const rings = stations.map(([x, r], k) => {
    const c = at(x);
    return Array.from({ length: BAR_SIDES }, (_, i) => {
      const angle = 0.4 + (i / BAR_SIDES) * Math.PI * 2;
      const rr = r * barJitter[k * BAR_SIDES + i];
      return add(c, add(scale(u, Math.cos(angle) * rr), scale(w, Math.sin(angle) * rr)));
    });
  });

  const solids: Solid[] = [];
  const last = rings.length - 1;
  for (let k = 0; k < last; k++) {
    const tris: Tri[] = [];
    for (let i = 0; i < BAR_SIDES; i++) {
      const j = (i + 1) % BAR_SIDES;
      // Rings run along the axis with angle increasing u towards w: this winding faces out.
      tris.push({ a: rings[k][i], b: rings[k][j], c: rings[k + 1][j] });
      tris.push({ a: rings[k][i], b: rings[k + 1][j], c: rings[k + 1][i] });
    }
    if (k === 0) for (let i = 1; i < BAR_SIDES - 1; i++) tris.push({ a: rings[0][0], b: rings[0][i + 1], c: rings[0][i] });
    if (k === last - 1) for (let i = 1; i < BAR_SIDES - 1; i++) tris.push({ a: rings[last][0], b: rings[last][i], c: rings[last][i + 1] });
    const mid = (stations[k][0] + stations[k + 1][0]) / 2;
    solids.push({ tris, centre: at(mid), colour: COPPER });
  }

  // The logo's fork withers as the stick straightens into a bar.
  const fork = 1 - phase(pose.form, 0, 0.5);
  if (fork > 0) {
    const foot = at(-half);
    const base = v(STICK_LENGTH * 0.66, 0, 0);
    const perp = v(-axis.y, axis.x, 0);
    const toWorld = (p: Vec3) => {
      const q = add(base, scale(sub(p, base), fork));
      return add(foot, add(add(scale(axis, q.x), scale(perp, q.y)), v(0, 0, q.z)));
    };
    solids.push({
      tris: transform(parts().fork, toWorld),
      centre: toWorld(v(STICK_LENGTH * 0.75, 0.15, 0)),
      colour: COPPER,
    });
  }
  return solids;
}

function plateSolids(pose: Pose): Solid[] {
  const { plates, boulder } = parts();
  const { f, at } = barFrame(pose);
  const solids: Solid[] = [];
  // The boulder splits into the first pair of plates as the stick becomes a bar.
  const fromRock = 1 - f;

  if (fromRock > 0) {
    const k = Math.max(0, 1 - phase(pose.form, 0.15, 0.8));
    if (k > 0) {
      solids.push({
        tris: transform(boulder, (p) => add(BOULDER_CENTRE, scale(p, k))),
        centre: BOULDER_CENTRE,
        colour: STONE,
      });
    }
  }

  for (const side of [-1, 1] as const) {
    for (let slot = 0; slot < MAX_PLATES; slot++) {
      let on = clamp01(pose.plates - slot);
      if (slot === 0) on = phase(pose.form, 0.15, 0.8) * (pose.plates > 0 ? 1 : 0);
      if (on <= 0) continue;
      const mesh = plates[slot * 2 + (side > 0 ? 1 : 0)];
      // Loaded from the end of the sleeve: slides on from outside.
      const slide = slot === 0 ? 0 : (1 - smooth(on)) * 0.5;
      let centre = at(side * (slotX(slot) + slide));
      // Solid from the first frame and grown, never faded: a see-through plate reads as wireframe.
      const size = slot === 0 ? lerp(0.45, 1, smooth(on)) : lerp(0.15, 1, smooth(on));
      // The first pair comes out of the boulder rather than off the end.
      if (slot === 0 && fromRock > 0) centre = lerp3(BOULDER_CENTRE, centre, smooth(on));
      solids.push({
        tris: transform(mesh, (p) => add(centre, scale(p, size))),
        centre,
        colour: STONE,
      });
    }
  }
  return solids;
}

function rackSolids(pose: Pose): Solid[] {
  const grow = smooth(pose.rack);
  if (grow <= 0) return [];
  const solids: Solid[] = [];
  const top = (pose.hook + 0.32) * grow;
  const hookY = pose.hook - SHAFT_RADIUS;
  for (const side of [-1, 1] as const) {
    const x = side * UPRIGHT_X;
    const footTris = box(v(x - 0.09, 0, UPRIGHT_Z - 0.42), v(x + 0.09, 0.05 * grow, UPRIGHT_Z + 0.34), "tfkle");
    solids.push({ tris: footTris, centre: v(x, 0.02, UPRIGHT_Z), colour: STEEL });
    const post = box(
      v(x - UPRIGHT_HALF, 0.05, UPRIGHT_Z - UPRIGHT_HALF),
      v(x + UPRIGHT_HALF, Math.max(0.06, top), UPRIGHT_Z + UPRIGHT_HALF),
      "tfkle",
    );
    solids.push({ tris: post, centre: v(x, top / 2, UPRIGHT_Z), colour: STEEL });
    if (grow > 0.85) {
      // The J-hook: a short arm forward under the bar, with a lip.
      const k = (grow - 0.85) / 0.15;
      const arm = box(v(x - 0.045, hookY - 0.07, UPRIGHT_Z), v(x + 0.045, hookY, UPRIGHT_Z + 0.32 * k));
      const lip = box(v(x - 0.045, hookY, UPRIGHT_Z + 0.27 * k), v(x + 0.045, hookY + 0.08 * k, UPRIGHT_Z + 0.32 * k));
      solids.push({ tris: [...arm, ...lip], centre: v(x, hookY, UPRIGHT_Z + 0.16), colour: STEEL });
    }
  }
  return solids;
}

function benchSolids(pose: Pose): Solid[] {
  const grow = smooth(pose.bench);
  if (grow <= 0) return [];
  const y = (h: number) => h * grow;
  const pad = box(v(-0.17, y(0.38), -0.42), v(0.17, y(0.5), 1.2));
  const legs = [-0.25, 1.05].map((z) => box(v(-0.13, 0, z - 0.05), v(0.13, y(0.38), z + 0.05), "fkle"));
  return [
    { tris: pad, centre: v(0, y(0.44), 0.39), colour: PAD },
    ...legs.map((tris, i) => ({ tris, centre: v(0, y(0.19), i ? 1.05 : -0.25), colour: STEEL })),
  ];
}

/* --- The platform ------------------------------------------------------ */

const DECK_DEPTH = 0.92;
const DECK_THICK = 0.07;
const DECK_HALF = 2.3;
const WOOD_HALF = 0.95;

/** Rubber where the plates land, wood in the middle where a lifter stands. */
function platform(pose: Pose): Solid[] {
  const k = smooth(pose.deck);
  if (k <= 0) return [];
  const strip = (x0: number, x1: number, colour: RGB, ends: string): Solid => {
    const tris = box(v(x0, -DECK_THICK, -DECK_DEPTH), v(x1, 0, DECK_DEPTH), "tfk" + ends);
    return { tris, centre: v((x0 + x1) / 2, -DECK_THICK / 2, 0), colour, opacity: k };
  };
  return [
    strip(-DECK_HALF, -WOOD_HALF, RUBBER, "l"),
    strip(-WOOD_HALF, WOOD_HALF, WOOD, ""),
    strip(WOOD_HALF, DECK_HALF, RUBBER, "e"),
  ];
}

/* --- Camera and projection ------------------------------------------- */

function camera(pose: Pose) {
  const target = v(0, pose.camY, 0);
  const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
  const cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
  return (p: Vec3): Vec3 => {
    const q = sub(p, target);
    const x = q.x * cy + q.z * sy;
    const z1 = -q.x * sy + q.z * cy;
    // Positive pitch looks down onto the platform.
    const y = q.y * cp - z1 * sp;
    const z = q.y * sp + z1 * cp;
    return v(x, y, z - pose.camDist);
  };
}

const rgb = ([r, g, b]: RGB, k: number): string =>
  `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Every polygon to draw for a pose, back to front.
 *
 * Painter's algorithm, sorted twice: solids by their centre, then faces
 * within a solid. The platform always goes first, then the shadows on it.
 * The bar is cut at every plate and upright, so each piece sorts against the
 * thing it passes through rather than the bar's middle.
 */
export function heroFrame(pose: Pose, view: Viewport): Poly[] {
  const toCamera = camera(pose);
  const focal = Math.min(view.width / 6.2, view.height / 4.6) * pose.camDist;
  const cx = view.width / 2;
  const cy = view.height / 2;
  const project = (p: Vec3): [number, number] => [cx + (focal * p.x) / -p.z, cy - (focal * p.y) / -p.z];

  const polys: Poly[] = [];
  const draw = (solids: Solid[]) => {
    const sorted = solids
      .map((s) => ({ s, depth: toCamera(s.centre).z }))
      .sort((p, q) => p.depth - q.depth);
    for (const { s } of sorted) {
      const faces: { depth: number; poly: Poly }[] = [];
      for (const tri of s.tris) {
        const a = toCamera(tri.a), b = toCamera(tri.b), c = toCamera(tri.c);
        const n = cross(sub(b, a), sub(c, a));
        const mid = scale(add(add(a, b), c), 1 / 3);
        if (dot(n, mid) >= 0) continue; // facing away
        const worldNormal = normalise(cross(sub(tri.b, tri.a), sub(tri.c, tri.a)));
        const light = Math.min(
          1,
          AMBIENT + (1 - AMBIENT) * Math.max(0, dot(worldNormal, LIGHT)) + FILL_STRENGTH * Math.max(0, dot(worldNormal, FILL)),
        );
        const [ax, ay] = project(a), [bx, by] = project(b), [qx, qy] = project(c);
        faces.push({
          depth: mid.z,
          poly: {
            points: [ax, ay, bx, by, qx, qy],
            fill: rgb(s.colour, light),
            // The logo's pale seams. Also covers the hairline gap anti-aliasing
            // leaves between two fills that share an edge.
            stroke: rgb(s.colour, Math.min(1, light * 1.12)),
            opacity: s.opacity ?? 1,
          },
        });
      }
      faces.sort((p, q) => p.depth - q.depth);
      for (const f of faces) polys.push(f.poly);
    }
  };

  draw(platform(pose));
  polys.push(...shadows(pose, (p) => project(toCamera(p))));
  draw([...rackSolids(pose), ...benchSolids(pose), ...barSolids(pose), ...plateSolids(pose)]);
  return polys;
}

/** Dark discs on the floor: under the boulder, then under each end of the bar. */
function shadows(pose: Pose, project: (p: Vec3) => [number, number]): Poly[] {
  const f = smooth(pose.form);
  const disc = (cx: number, cz: number, rx: number, rz: number, opacity: number): Poly => {
    const points: number[] = [];
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      points.push(...project(v(cx + Math.cos(angle) * rx, 0.002, cz + Math.sin(angle) * rz)));
    }
    return { points, fill: "rgb(0,0,0)", stroke: null, opacity };
  };
  const out: Poly[] = [];
  if (f < 1) out.push(disc(BOULDER_CENTRE.x - 0.1, BOULDER_CENTRE.z + 0.25, 1.45, 0.95, 0.22 * (1 - f)));
  if (f > 0) {
    const lifted = clamp01((pose.barY - PLATE_RADIUS) / 1.2);
    const width = 0.2 + Math.max(1, pose.plates) * PLATE_HALF_WIDTH;
    for (const side of [-1, 1]) {
      const x = side * (COLLAR_X + width - 0.15);
      out.push(disc(x, pose.barZ, width * (1 + lifted * 0.4), 0.8 * (1 + lifted * 0.4), 0.3 * f * (1 - 0.65 * lifted)));
    }
  }
  return out;
}
