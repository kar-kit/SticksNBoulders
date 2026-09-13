import type { Metadata } from "next";

/**
 * The component library ships in the production build. That is useful while
 * building and harmless to a signed-out visitor, but it should be gated before
 * the December handover so Ruairi cannot wander into it. Noindex is the cheap
 * half of that; the routing decision is Joey's.
 */
export const metadata: Metadata = {
  title: "Component library — Sticks N Boulders",
  robots: { index: false, follow: false },
};

export default function DesignLayout({ children }: LayoutProps<"/design">) {
  return children;
}
