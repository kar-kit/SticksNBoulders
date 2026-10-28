import { FINAL_POSE, heroFrame } from "@/lib/landing/hero-geometry";

/** The poster's own coordinate space. The canvas shares its 4:3 shape. */
export const POSTER_WIDTH = 640;
export const POSTER_HEIGHT = 480;

/**
 * The hero's last frame as SVG (the bar locked out on the third rep), rendered on the server.
 *
 * It is the whole hero for anyone who does not get the animation, and the
 * first thing everyone else sees while the animation loads. A server
 * component, so the geometry it runs never ships to the browser for it.
 */
export function HeroPoster({ className }: { className?: string }) {
  const polys = heroFrame(FINAL_POSE, { width: POSTER_WIDTH, height: POSTER_HEIGHT });
  return (
    <svg
      viewBox={`0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}`}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {polys.map((poly, i) => (
        <polygon
          key={i}
          points={poly.points.map((n) => n.toFixed(1)).join(" ")}
          fill={poly.fill}
          stroke={poly.stroke ?? undefined}
          strokeWidth={poly.stroke ? 0.6 : undefined}
          strokeLinejoin="round"
          opacity={poly.opacity === 1 ? undefined : poly.opacity}
        />
      ))}
    </svg>
  );
}
