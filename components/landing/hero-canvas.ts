import { heroFrame, weekAt, type Poly } from "@/lib/landing/hero-geometry";
import { TOTAL_MS, timelineAt, tooSlow } from "@/lib/landing/hero-mode";

/**
 * The hero's animation loop. Loaded with `import()` from hero.tsx only when
 * the hero is on screen and allowed to move, so none of this (or the geometry)
 * is in the page's first JavaScript.
 *
 * Plays once, then stops asking for frames: an idle landing page costs
 * nothing. Pauses with the tab hidden or the hero scrolled away.
 */

/** Past 2x the extra pixels are invisible and the fill cost is not. */
const MAX_PIXEL_RATIO = 2;

export interface Player {
  play(): void;
  pause(): void;
  resume(): void;
  /** Straight to the last frame, and stop. */
  skip(): void;
  /** Redraw the current frame at the canvas's current size. */
  resize(): void;
  destroy(): void;
}

export interface PlayerHooks {
  /** Every frame drawn, with the week it shows. */
  onFrame(week: number): void;
  /** Playback reached the end, or gave up on a slow device. */
  onDone(reason: "finished" | "slow"): void;
}

export function createPlayer(canvas: HTMLCanvasElement, hooks: PlayerHooks): Player | null {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;

  let width = 0;
  let height = 0;
  let t = 1;
  let elapsed = 0;
  let last: number | null = null;
  let frame: number | null = null;
  let playing = false;
  let paused = false;
  const gaps: number[] = [];

  function fit() {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw() {
    ctx!.clearRect(0, 0, width, height);
    ctx!.lineJoin = "round";
    ctx!.lineWidth = 0.6;
    for (const poly of heroFrame(t, { width, height })) fill(ctx!, poly);
    hooks.onFrame(weekAt(t));
  }

  function tick(now: number) {
    frame = null;
    if (last !== null) {
      const gap = now - last;
      elapsed += gap;
      gaps.push(gap);
    }
    last = now;
    t = timelineAt(elapsed);
    draw();

    if (tooSlow(gaps)) {
      // Not keeping up: jump to the end, which is the poster, and stop.
      finish("slow");
      return;
    }
    if (elapsed >= TOTAL_MS) {
      finish("finished");
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function finish(reason: "finished" | "slow") {
    playing = false;
    t = 1;
    draw();
    hooks.onDone(reason);
  }

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    last = null;
  }

  fit();
  draw();

  return {
    play() {
      stop();
      elapsed = 0;
      gaps.length = 0;
      playing = true;
      if (!paused) frame = requestAnimationFrame(tick);
    },
    pause() {
      paused = true;
      stop();
    },
    resume() {
      paused = false;
      // The slow-device sample restarts too: frames across a pause are not a
      // measure of anything.
      gaps.length = 0;
      if (playing && frame === null) frame = requestAnimationFrame(tick);
    },
    skip() {
      stop();
      playing = false;
      t = 1;
      draw();
    },
    resize() {
      fit();
      draw();
    },
    destroy() {
      stop();
      playing = false;
    },
  };
}

function fill(ctx: CanvasRenderingContext2D, poly: Poly) {
  const p = poly.points;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.closePath();
  ctx.globalAlpha = poly.opacity;
  ctx.fillStyle = poly.fill;
  ctx.fill();
  if (poly.stroke) {
    ctx.strokeStyle = poly.stroke;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
