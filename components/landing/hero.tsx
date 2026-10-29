"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { chooseHero, FINAL_LABEL } from "@/lib/landing/hero-mode";
import type { Player } from "./hero-canvas";

type Status = "still" | "loading" | "playing" | "done";

interface Connection {
  saveData?: boolean;
}

/**
 * The landing hero: the server's poster, with the animation laid over it once
 * it has earned its place (lib/landing/hero-mode.ts). The poster is passed in
 * as children so its geometry stays on the server.
 *
 * Fixed 4:3 box from the first paint, poster and canvas stacked in it, so
 * nothing moves when one replaces the other: the canvas's first frame is the
 * poster.
 */
export function Hero({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const player = useRef<Player | null>(null);
  const [status, setStatus] = useState<Status>("still");
  // Whether the play button is offered at all: anyone who can draw a canvas,
  // including reduced-motion visitors, who get it on request and never by
  // default.
  const [canPlay, setCanPlay] = useState(false);

  /** Loads the player on first use. Resolves null where no canvas can be had. */
  async function load(): Promise<Player | null> {
    if (player.current) return player.current;
    if (!canvas.current) return null;
    const { createPlayer } = await import("./hero-canvas");
    if (!canvas.current) return null;
    player.current = createPlayer(canvas.current, {
      onFrame(text) {
        if (label.current && label.current.textContent !== text) label.current.textContent = text;
      },
      onDone() {
        setStatus("done");
      },
    });
    return player.current;
  }

  async function start() {
    setStatus("loading");
    const p = await load();
    if (!p) {
      setStatus("still");
      setCanPlay(false);
      return;
    }
    p.play();
    setStatus("playing");
  }

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const canvasWorks = !!document.createElement("canvas").getContext("2d");
    const mode = chooseHero({
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      saveData: connection?.saveData === true,
      canvas: canvasWorks,
      cores: navigator.hardwareConcurrency || undefined,
    });
    // Client-only facts, so they can only be learned after hydration.
    setCanPlay(canvasWorks);

    let started = false;
    const visible = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!started && mode === "animate") {
            started = true;
            void start();
          }
          player.current?.resume();
        } else {
          player.current?.pause();
        }
      },
      { threshold: 0.2 },
    );
    visible.observe(element);

    const onVisibility = () => (document.hidden ? player.current?.pause() : player.current?.resume());
    document.addEventListener("visibilitychange", onVisibility);
    const resized = new ResizeObserver(() => player.current?.resize());
    resized.observe(element);

    return () => {
      visible.disconnect();
      resized.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      player.current?.destroy();
      player.current = null;
    };
    // `start` is stable in behaviour; it reads refs, not state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onButton() {
    if (status === "playing") {
      // WCAG 2.2.2: anything that moves for more than five seconds on its own
      // can be stopped. Stopping goes to the end, which is the still picture.
      player.current?.skip();
      setStatus("done");
      return;
    }
    void start();
  }

  const drawn = status === "playing" || status === "done";

  return (
    <figure className="m-0">
      <div ref={box} className="relative aspect-[4/3] w-full">
        <div className={drawn ? "invisible" : undefined}>{children}</div>
        <canvas
          ref={canvas}
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full ${drawn ? "" : "invisible"}`}
        />
      </div>
      <figcaption className="flex min-h-12 items-center justify-between gap-4 border-t border-border">
        <span ref={label} className="font-mono text-label uppercase text-muted-2" aria-hidden="true">
          {FINAL_LABEL}
        </span>
        <span className="sr-only">
          The Sticks N Boulders logo, a stick leaning on a boulder. The stick straightens into a barbell and the
          boulder splits into its first plates. Three more plates are slammed onto each end, one at a time, then
          the bar is deadlifted once with four plates a side and set down hard, before it all folds back into the
          stick and the boulder.
        </span>
        {canPlay && (
          <button
            type="button"
            onClick={onButton}
            disabled={status === "loading"}
            className="inline-flex h-11 items-center font-mono text-label uppercase text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line disabled:text-muted-2"
          >
            {status === "playing" ? "Stop" : status === "done" ? "Replay" : "Play"}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
