/**
 * The landing hero: a stick becomes a bar, sticks become stone plates, and the
 * bar comes off the floor.
 *
 * Pure geometry and nothing else. `heroFrame(pose)` returns flat-shaded
 * polygons in screen space, and two renderers draw them: the server's SVG
 * poster (`components/landing/hero-poster.tsx`) and the canvas loop
 * (`components/landing/hero-canvas.ts`). Both read the same function, so the
 * poster is exactly the canvas's last frame and swapping one for the other
 * moves nothing on screen. What happens when is `lib/landing/hero-mode.ts`.
 *
 * Software 3D on purpose. The scene is a few hundred flat triangles with one
 * light, which needs a depth sort and a fill, not a GPU pipeline: three.js
 * would cost ~150 KB gzipped for what is ~4 KB here, and Canvas 2D runs on
 * every device that has no WebGL. docs/landing-page.md has the comparison.
 *
 * A pose has three numbers:
 *   build  0 -> 0.6   sticks land around both ends of the bar, slowly at first
 *          0.6 -> 0.95 each heap packs into a faceted stone plate
 *          0 -> 0.95   the bar itself thickens from a twig to a barbell
 *   lift   0 = plates on the platform, 1 = locked out. The bar bends as it
 *          breaks from the floor, the way a loaded bar does.
 *   yaw    the camera's turn around the bar.
 */

import { FINAL_POSE, type Pose } from "./hero-mode";

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
}

/* --- Palette ----------------------------------------------------------- */

/*
 * Lit-face colours from SNB.png, not from globals.css: the logo's copper
 * stick is lighter than --accent-fill because it is a lit surface, and its
 * shaded faces fall to the logo's dark brown. Same for the stone. The
 * platform is kept dark so the bar and plates carry the picture: rubber a
 * step above the page background, the wooden centre a dim copper.
 */
const COPPER: RGB = [236, 180, 126];
const STONE: RGB = [204, 203, 209];
const RUBBER: RGB = [64, 63, 70];
const WOOD: RGB = [100, 79, 60];
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

/**
 * A short faceted stick from `a` to `b`, with a kink ring part way along so it
 * reads as split wood rather than a pencil.
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
      const k = r * (1 + (rng() - 0.5) * 0.3);
      return add(centre, add(scale(u, Math.cos(angle) * k), scale(w, Math.sin(angle) * k)));
    });
  const kink = 0.35 + rng() * 0.3;
  const rings = [ring(a, radius * 0.92), ring(add(a, scale(sub(b, a), kink)), radius * 1.06), ring(b, radius * 0.8)];
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
  return outward(tris, scale(add(a, b), 0.5));
}

/**
 * A stone plate: an icosahedron split once (80 faces), squashed to a disc
 * along x and pushed about so it reads as rock. Centred on the origin.
 */
function stonePlate(rng: () => number): Tri[] {
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
    const k = PLATE_RADIUS * (0.88 + rng() * 0.2);
    return v(p.x * PLATE_HALF_WIDTH * (0.9 + rng() * 0.25), p.y * k, p.z * k);
  });
  return outward(
    split.map(([a, b, c]) => ({ a: placed[a], b: placed[b], c: placed[c] })),
    v(0, 0, 0),
  );
}

/* --- The scene, built once --------------------------------------------- */

/** Where the plates sit along the bar, and their size. */
const PLATE_X = 1.5;
const PLATE_RADIUS = 0.72;
const PLATE_HALF_WIDTH = 0.28;
/** Floor to lockout, in plate-centre height. */
const LIFT_HEIGHT = 0.8;
/** Sticks per end. Each one is a session nobody filmed. */
export const STICKS_PER_SIDE = 26;
/** Where the sleeve (thicker) begins, inside the plates. */
const COLLAR_X = 1.2;
const BAR_SIDES = 6;

interface BundleStick {
  tris: Tri[];
  /** Relative to its plate's centre. */
  centre: Vec3;
  side: -1 | 1;
  radius: number;
  arrives: number;
}

interface Scene {
  plates: [Tri[], Tri[]];
  bundle: BundleStick[];
  /** Per bar ring vertex, a fixed radius wobble: the low-poly look, held still. */
  barJitter: number[];
}

function buildScene(): Scene {
  const rng = random(0x5b0b);
  const bundle: Omit<BundleStick, "arrives">[] = [];
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < STICKS_PER_SIDE; i++) {
      // Wound round the sleeve in the plate's plane: a heap that will become a plate.
      const angle = rng() * Math.PI * 2;
      const radius = 0.14 + Math.sqrt(rng()) * 0.56;
      const centre = v((rng() - 0.5) * 0.3, Math.sin(angle) * radius, Math.cos(angle) * radius);
      const along = normalise(v((rng() - 0.5) * 0.5, Math.cos(angle), -Math.sin(angle)));
      const half = 0.17 + rng() * 0.18;
      bundle.push({
        tris: stick(sub(centre, scale(along, half)), add(centre, scale(along, half)), 0.03 + rng() * 0.025, 4, rng),
        centre,
        side,
        radius,
      });
    }
  }
  // Each heap grows outward from the bar, and the gaps between arrivals
  // shrink as it goes: the first weeks are the slow ones.
  bundle.sort((p, q) => p.radius - q.radius);
  const total = bundle.length;
  return {
    plates: [stonePlate(rng), stonePlate(rng)],
    bundle: bundle.map((s, i) => ({ ...s, arrives: 0.58 * Math.sqrt(i / total) })),
    barJitter: Array.from({ length: 16 * BAR_SIDES }, () => 1 + (rng() - 0.5) * 0.16),
  };
}

let built: Scene | null = null;
const scene = (): Scene => (built ??= buildScene());

/* --- Posing ------------------------------------------------------------ */

const transform = (tris: Tri[], f: (p: Vec3) => Vec3): Tri[] => tris.map((t) => ({ a: f(t.a), b: f(t.b), c: f(t.c) }));

/** How far one stick has landed, 0 to 1. */
const landed = (s: BundleStick, build: number): number => phase(build, s.arrives, s.arrives + 0.05);

/**
 * Plate-centre height before any lift. The heaps hold the bar up, so it rises
 * as they grow: the outermost stick that has landed sets the height.
 */
function restHeight(build: number, barRadius: number): number {
  let heap = 0;
  for (const s of scene().bundle) heap = Math.max(heap, s.radius * landed(s, build));
  const packed = lerp(heap + 0.04, PLATE_RADIUS * 0.97, phase(build, 0.6, 0.95));
  return Math.max(barRadius, packed);
}

/**
 * How much the bar bends: plates hanging from the ends, centre leading. Most
 * as it breaks from the floor, a little left at lockout under the load.
 */
export function bendAt(lift: number): number {
  const whip = lift < 0.5 ? Math.sin(Math.PI * (lift / 0.5)) * 0.12 : 0;
  return whip + 0.03 * Math.min(1, lift * 6);
}

function solidsAt(pose: Pose): Solid[] {
  const { plates, bundle, barJitter } = scene();
  const build = clamp01(pose.build);
  const lift = clamp01(pose.lift);
  const grown = smooth(build / 0.95);
  const pack = phase(build, 0.6, 0.95);

  const shaft = 0.032 + grown * 0.04;
  const sleeve = shaft * (1 + 0.5 * pack);
  const half = 1.75 + grown * 0.45;
  const plateY = restHeight(build, shaft) + lift * LIFT_HEIGHT;
  const bend = bendAt(lift);
  const yAt = (x: number) => plateY + bend * (1 - (x / PLATE_X) ** 2);

  const solids: Solid[] = [];

  // The bar, in five pieces so each can be sorted against the plates it
  // passes through: outer sleeve, inside plate, shaft, inside plate, sleeve.
  const outerFace = Math.min(PLATE_X + PLATE_HALF_WIDTH, half - 0.02);
  const innerFace = PLATE_X - PLATE_HALF_WIDTH;
  const stations: [number, number][] = [
    [-half, sleeve], [-outerFace, sleeve], [-innerFace, sleeve],
    [-COLLAR_X, sleeve], [-COLLAR_X + 0.02, shaft], [-0.6, shaft], [0, shaft], [0.6, shaft], [COLLAR_X - 0.02, shaft],
    [COLLAR_X, sleeve], [innerFace, sleeve], [outerFace, sleeve], [half, sleeve],
  ];
  const rings = stations.map(([x, r], k) => {
    const centre = v(x, yAt(x), 0);
    return Array.from({ length: BAR_SIDES }, (_, i) => {
      const angle = 0.4 + (i / BAR_SIDES) * Math.PI * 2;
      const rr = r * barJitter[k * BAR_SIDES + i];
      return add(centre, v(0, Math.cos(angle) * rr, Math.sin(angle) * rr));
    });
  });
  const pieces: [number, number, number][] = [
    // [first station, last station, plate it belongs with (0 none, -1/1)]
    [0, 1, 0], [1, 2, -1], [2, 10, 0], [10, 11, 1], [11, 12, 0],
  ];
  for (const [from, to, plate] of pieces) {
    const tris: Tri[] = [];
    for (let k = from; k < to; k++) {
      for (let i = 0; i < BAR_SIDES; i++) {
        const j = (i + 1) % BAR_SIDES;
        // Rings run along +x with angle increasing y towards z: this winding faces out.
        tris.push({ a: rings[k][i], b: rings[k][j], c: rings[k + 1][j] });
        tris.push({ a: rings[k][i], b: rings[k + 1][j], c: rings[k + 1][i] });
      }
    }
    if (from === 0) for (let i = 1; i < BAR_SIDES - 1; i++) tris.push({ a: rings[0][0], b: rings[0][i + 1], c: rings[0][i] });
    const last = rings.length - 1;
    if (to === last) for (let i = 1; i < BAR_SIDES - 1; i++) tris.push({ a: rings[last][0], b: rings[last][i], c: rings[last][i + 1] });
    const x = plate ? plate * PLATE_X : (stations[from][0] + stations[to][0]) / 2;
    solids.push({ tris, centre: v(x, yAt(x), 0), colour: COPPER });
  }

  // The heaps, landing, then packing into the plates.
  for (const s of bundle) {
    const l = landed(s, build);
    if (l <= 0 || pack >= 1) continue;
    const anchor = v(s.side * PLATE_X, yAt(s.side * PLATE_X), 0);
    const size = l * (1 - pack);
    const at = add(anchor, add(scale(s.centre, 1 - pack * 0.6), v(0, (1 - l) * 1.1, 0)));
    const move = (q: Vec3) => add(at, scale(sub(q, s.centre), size));
    solids.push({ tris: transform(s.tris, move), centre: at, colour: COPPER });
  }

  if (pack > 0) {
    const k = 0.35 + 0.65 * Math.pow(pack, 0.7);
    // The heaps' copper turns to stone as they pack.
    const colour = STONE.map((c, i) => Math.round(COPPER[i] + (c - COPPER[i]) * pack)) as unknown as RGB;
    ([-1, 1] as const).forEach((side, n) => {
      const centre = v(side * PLATE_X, yAt(side * PLATE_X), 0);
      solids.push({ tris: transform(plates[n], (q) => add(centre, scale(q, k))), centre, colour });
    });
  }
  return solids;
}

/* --- The platform ------------------------------------------------------ */

const DECK_DEPTH = 0.92;
const DECK_THICK = 0.07;
const DECK_HALF = 2.3;
const WOOD_HALF = 0.95;

/** Rubber where the plates land, wood in the middle where a lifter stands. */
function platform(): Solid[] {
  const strip = (x0: number, x1: number, colour: RGB, ends: boolean): Solid => {
    const y0 = -DECK_THICK, y1 = 0, z0 = -DECK_DEPTH, z1 = DECK_DEPTH;
    const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Tri[] => [{ a, b, c }, { a, b: c, c: d }];
    const tris = [
      ...quad(v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1)),
      ...quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)),
      ...quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0)),
      ...(ends
        ? [
            ...quad(v(x0, y0, z0), v(x0, y1, z0), v(x0, y1, z1), v(x0, y0, z1)),
            ...quad(v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)),
          ]
        : []),
    ];
    const centre = v((x0 + x1) / 2, -DECK_THICK / 2, 0);
    return { tris: outward(tris, centre), centre, colour };
  };
  return [
    strip(-DECK_HALF, -WOOD_HALF, RUBBER, true),
    strip(-WOOD_HALF, WOOD_HALF, WOOD, false),
    strip(WOOD_HALF, DECK_HALF, RUBBER, true),
  ];
}

/* --- Camera and projection ------------------------------------------- */

const TARGET = v(0, 0.82, 0);
const DISTANCE = 7.6;
/** Positive looks down onto the platform. */
const PITCH = 0.36;

function toCamera(p: Vec3, yaw: number): Vec3 {
  const q = sub(p, TARGET);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x = q.x * cy + q.z * sy;
  const z1 = -q.x * sy + q.z * cy;
  const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  const y = q.y * cp - z1 * sp;
  const z = q.y * sp + z1 * cp;
  return v(x, y, z - DISTANCE);
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
 * The bar is cut where it passes through each plate, so a plate can hide the
 * piece inside it without hiding the rest.
 */
export function heroFrame(pose: Pose, view: Viewport): Poly[] {
  const yaw = pose.yaw;
  const focal = Math.min(view.width / 6.2, view.height / 4.6) * DISTANCE;
  const cx = view.width / 2;
  const cy = view.height / 2;
  const project = (p: Vec3): [number, number] => [cx + (focal * p.x) / -p.z, cy - (focal * p.y) / -p.z];

  const polys: Poly[] = [];
  const draw = (solids: Solid[]) => {
    const sorted = solids
      .map((s) => ({ s, depth: toCamera(s.centre, yaw).z }))
      .sort((p, q) => p.depth - q.depth);
    for (const { s } of sorted) {
      const faces: { depth: number; poly: Poly }[] = [];
      for (const tri of s.tris) {
        const a = toCamera(tri.a, yaw), b = toCamera(tri.b, yaw), c = toCamera(tri.c, yaw);
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
            opacity: 1,
          },
        });
      }
      faces.sort((p, q) => p.depth - q.depth);
      for (const f of faces) polys.push(f.poly);
    }
  };

  draw(platform());
  polys.push(...shadows(pose, project));
  draw(solidsAt(pose));
  return polys;
}

/** A dark disc under each end, fading as the bar leaves the floor. */
function shadows(pose: Pose, project: (p: Vec3) => [number, number]): Poly[] {
  const build = clamp01(pose.build);
  const lift = clamp01(pose.lift);
  const size = 0.35 + 0.65 * phase(build, 0.05, 0.95);
  return ([-1, 1] as const).map((side) => {
    const points: number[] = [];
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const spread = size * (1 + lift * 0.4);
      const p = v(side * PLATE_X + Math.cos(angle) * 0.42 * spread, 0.002, Math.sin(angle) * 0.85 * spread);
      points.push(...project(toCamera(p, pose.yaw)));
    }
    return { points, fill: "rgb(0,0,0)", stroke: null, opacity: 0.32 * (1 - 0.6 * lift) };
  });
}
