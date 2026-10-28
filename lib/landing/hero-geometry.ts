/**
 * The landing hero: one thin stick, a pile of sticks, a boulder.
 *
 * Pure geometry and nothing else. `heroFrame(t)` returns flat-shaded polygons
 * in screen space for a point on the timeline, and two renderers draw them:
 * the server's SVG poster (`components/landing/hero-poster.tsx`) and the
 * canvas loop (`components/landing/hero-canvas.ts`). Because both read the
 * same function, the poster is exactly the canvas's last frame, so swapping
 * one for the other moves nothing on screen.
 *
 * Software 3D on purpose. The scene is a few hundred flat triangles with one
 * light, which needs a depth sort and a fill, not a GPU pipeline: three.js
 * would cost ~150 KB gzipped for what is ~4 KB here, and Canvas 2D runs on
 * every device that has no WebGL. docs/landing-page.md has the comparison.
 *
 * The timeline, t from 0 to 1:
 *   0    -> 0.62  sticks land on the pile one at a time, slowly at first
 *   0.62 -> 0.86  the pile packs down into a boulder
 *   0.70 -> 1     the first stick, which has thickened all along, stands up
 *                 and leans on the boulder: the logo
 */

import { TOTAL_WEEKS } from "./hero-mode";

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
 * shaded faces fall to the logo's dark brown. Same for the stone.
 */
const COPPER: RGB = [236, 180, 126];
const STONE: RGB = [204, 203, 209];
/** Faces turned fully away from the light keep this much of their colour. */
const AMBIENT = 0.3;

/* --- Small vector maths ------------------------------------------------ */

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (p: Vec3, q: Vec3): Vec3 => v(p.x + q.x, p.y + q.y, p.z + q.z);
const sub = (p: Vec3, q: Vec3): Vec3 => v(p.x - q.x, p.y - q.y, p.z - q.z);
const scale = (p: Vec3, k: number): Vec3 => v(p.x * k, p.y * k, p.z * k);
const dot = (p: Vec3, q: Vec3): number => p.x * q.x + p.y * q.y + p.z * q.z;
const cross = (p: Vec3, q: Vec3): Vec3 => v(p.y * q.z - p.z * q.y, p.z * q.x - p.x * q.z, p.x * q.y - p.y * q.x);
const lerp3 = (p: Vec3, q: Vec3, k: number): Vec3 => add(p, scale(sub(q, p), k));

function normalise(p: Vec3): Vec3 {
  const length = Math.hypot(p.x, p.y, p.z) || 1;
  return scale(p, 1 / length);
}

/** Up and to the left, as on the logo. */
const LIGHT = normalise(v(-0.55, 0.78, 0.45));

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
 * A faceted stick from `a` to `b`: `sides` faces round, with a kink ring part
 * way along so it reads as split wood rather than a pencil. `jitter` moves the
 * ring vertices, which is where the low-poly look comes from.
 */
function stick(a: Vec3, b: Vec3, radius: number, sides: number, rng: () => number, jitter = 0.18): Tri[] {
  const axis = normalise(sub(b, a));
  const helper = Math.abs(axis.y) > 0.9 ? v(1, 0, 0) : v(0, 1, 0);
  const u = normalise(cross(axis, helper));
  const w = cross(axis, u);
  const turn = rng() * Math.PI * 2;
  const ring = (centre: Vec3, r: number): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const angle = turn + (i / sides) * Math.PI * 2;
      const k = r * (1 + (rng() - 0.5) * jitter);
      return add(centre, add(scale(u, Math.cos(angle) * k), scale(w, Math.sin(angle) * k)));
    });

  const kinkAt = 0.35 + rng() * 0.3;
  const rings = [ring(a, radius * 0.92), ring(lerp3(a, b, kinkAt), radius * 1.06), ring(b, radius * 0.8)];
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

/** An icosahedron split once (80 faces), pushed about so it reads as stone. */
function boulder(centre: Vec3, radius: number, rng: () => number): Tri[] {
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
    const k = radius * (0.9 + rng() * 0.17);
    // Wider than tall, and a flatter underside: a boulder that has settled.
    const y = p.y < 0 ? p.y * 0.6 : p.y * 0.9;
    return add(centre, v(p.x * k * 1.12, y * k, p.z * k));
  });
  return outward(
    split.map(([a, b, c]) => ({ a: placed[a], b: placed[b], c: placed[c] })),
    centre,
  );
}

/* --- The scene, built once --------------------------------------------- */

const BOULDER_CENTRE = v(0.62, 0.6, -0.3);
const BOULDER_RADIUS = 1.0;
const FOOT = v(-1.25, 0.04, 0.5);
/** Sticks on the pile. Each one is a session nobody filmed. */
export const PILE_SIZE = 42;

interface PileStick {
  tris: Tri[];
  centre: Vec3;
  arrives: number;
}

interface Scene {
  boulder: Tri[];
  pile: PileStick[];
}

function buildScene(): Scene {
  const rng = random(0x5b0b);
  const pile: Omit<PileStick, "arrives">[] = [];
  for (let i = 0; i < PILE_SIZE; i++) {
    // Inside the boulder's footprint, lying mostly flat.
    const angle = rng() * Math.PI * 2;
    const reach = Math.sqrt(rng()) * 0.82;
    const centre = v(
      BOULDER_CENTRE.x + Math.cos(angle) * reach * 1.05,
      // Higher in the middle than at the edge: a heap, settled under its own weight.
      0.06 + rng() * 1.15 * (1 - reach),
      BOULDER_CENTRE.z + Math.sin(angle) * reach * 0.62,
    );
    const heading = rng() * Math.PI;
    const tilt = (rng() - 0.5) * 0.7;
    const half = 0.3 + rng() * 0.26;
    const dir = normalise(v(Math.cos(heading), tilt, Math.sin(heading)));
    pile.push({
      tris: stick(sub(centre, scale(dir, half)), add(centre, scale(dir, half)), 0.035 + rng() * 0.03, 4, rng, 0.3),
      centre,
    });
  }
  // A heap fills from the bottom. The gaps between arrivals shrink as it goes:
  // the first weeks are the slow ones.
  pile.sort((p, q) => p.centre.y - q.centre.y);
  return {
    boulder: boulder(BOULDER_CENTRE, BOULDER_RADIUS, rng),
    pile: pile.map((p, i) => ({ ...p, arrives: 0.6 * Math.sqrt(i / PILE_SIZE) })),
  };
}

let built: Scene | null = null;
const scene = (): Scene => (built ??= buildScene());

/* --- Animating --------------------------------------------------------- */

const transform = (tris: Tri[], f: (p: Vec3) => Vec3): Tri[] => tris.map((t) => ({ a: f(t.a), b: f(t.b), c: f(t.c) }));

/** The first stick: a twig on the ground at t=0, the logo's stick at t=1. */
function leadStick(t: number): Tri[] {
  const growth = smooth(t);
  const stand = phase(t, 0.7, 1);
  const angle = 0.05 + stand * 0.73;
  const length = 1.9 + growth * 0.75;
  const radius = 0.045 + growth * 0.125;
  const dir = v(Math.cos(angle) * 0.97, Math.sin(angle), -0.24 * Math.cos(angle) * 0.6);
  const top = add(FOOT, scale(normalise(dir), length));
  // Fresh seeds per frame, same values every frame: the stick keeps its facets.
  const main = stick(FOOT, top, radius, 6, random(0x51c4), 0.16);
  const forkFrom = lerp3(FOOT, top, 0.66);
  const forkDir = normalise(v(Math.cos(angle + 0.62), Math.sin(angle + 0.62), -0.05));
  const fork = stick(forkFrom, add(forkFrom, scale(forkDir, length * 0.3)), radius * 0.72, 5, random(0xf02c), 0.16);
  return [...main, ...fork];
}

function solidsAt(t: number): Solid[] {
  const { boulder: rock, pile } = scene();
  const pack = phase(t, 0.62, 0.86);
  const solids: Solid[] = [];

  for (const p of pile) {
    const landed = phase(t, p.arrives, p.arrives + 0.06);
    if (landed <= 0 || pack >= 1) continue;
    const drop = (1 - landed) * 1.1;
    const size = landed * (1 - pack);
    const to = lerp3(p.centre, BOULDER_CENTRE, pack * 0.7);
    const move = (q: Vec3) => add(to, add(scale(sub(q, p.centre), size), v(0, drop, 0)));
    solids.push({ tris: transform(p.tris, move), centre: move(p.centre), colour: COPPER });
  }

  if (pack > 0) {
    const k = 0.35 + 0.65 * Math.pow(pack, 0.7);
    const grow = (q: Vec3) => add(BOULDER_CENTRE, scale(sub(q, BOULDER_CENTRE), k));
    // The pile's copper turns to stone as it packs.
    const colour = STONE.map((c, i) => Math.round(COPPER[i] + (c - COPPER[i]) * pack)) as unknown as RGB;
    solids.push({ tris: transform(rock, grow), centre: BOULDER_CENTRE, colour });
  }

  const lead = leadStick(t);
  const centre = scale(lead.reduce((s, tri) => add(s, tri.a), v(0, 0, 0)), 1 / lead.length);
  solids.push({ tris: lead, centre, colour: COPPER });
  return solids;
}

/* --- Camera and projection ------------------------------------------- */

const TARGET = v(0.0, 0.86, 0);
const DISTANCE = 7.2;
const PITCH = -0.2;
/** The resting yaw. The build starts further round and swings to here. */
export const REST_YAW = -0.32;
export const START_YAW = -0.78;

export const yawAt = (t: number): number => START_YAW + (REST_YAW - START_YAW) * smooth(t);

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
 * Every polygon to draw at time `t`, back to front.
 *
 * Painter's algorithm, sorted twice: solids by their centre, then faces
 * within a solid. Sorting all faces together would let the boulder's near
 * side poke through the stick resting on it.
 */
export function heroFrame(t: number, view: Viewport, yaw = yawAt(t)): Poly[] {
  const time = clamp01(t);
  const focal = Math.min(view.width / 4.4, view.height / 3.1) * DISTANCE;
  const cx = view.width / 2;
  const cy = view.height / 2;
  const project = (p: Vec3): [number, number] => [cx + (focal * p.x) / -p.z, cy - (focal * p.y) / -p.z];

  const polys: Poly[] = [shadow(time, yaw, project)];
  const solids = solidsAt(time)
    .map((s) => ({ s, depth: toCamera(s.centre, yaw).z }))
    .sort((p, q) => p.depth - q.depth);

  for (const { s } of solids) {
    const faces: { depth: number; poly: Poly }[] = [];
    for (const tri of s.tris) {
      const a = toCamera(tri.a, yaw), b = toCamera(tri.b, yaw), c = toCamera(tri.c, yaw);
      const n = cross(sub(b, a), sub(c, a));
      const mid = scale(add(add(a, b), c), 1 / 3);
      if (dot(n, mid) >= 0) continue; // facing away
      const worldNormal = normalise(cross(sub(tri.b, tri.a), sub(tri.c, tri.a)));
      const light = AMBIENT + (1 - AMBIENT) * Math.max(0, dot(worldNormal, LIGHT));
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
  return polys;
}

/** A flat dark disc under the heap: something for it to sit on. */
function shadow(t: number, yaw: number, project: (p: Vec3) => [number, number]): Poly {
  const spread = 0.55 + 0.45 * phase(t, 0.05, 0.86);
  const points: number[] = [];
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const p = v(BOULDER_CENTRE.x - 0.1 + Math.cos(angle) * 1.45 * spread, 0, BOULDER_CENTRE.z + 0.25 + Math.sin(angle) * 0.95 * spread);
    points.push(...project(toCamera(p, yaw)));
  }
  return { points, fill: "rgb(0,0,0)", stroke: null, opacity: 0.22 };
}

/** The label under the hero: which week of the build `t` is. */
export const weekAt = (t: number): number => 1 + Math.round(clamp01(t / 0.86) * (TOTAL_WEEKS - 1));
