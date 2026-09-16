import { BodyweightScreen } from "@/components/bodyweight/bodyweight-screen";

export const metadata = { title: "Bodyweight — Sticks N Boulders" };

/**
 * Reached from Profile rather than from the tab bar. The blueprint puts four
 * tabs on the athlete side and this is not one of them -- a screen visited once
 * a morning does not earn a permanent quarter of the bottom bar.
 */
export default function BodyweightPage() {
  return <BodyweightScreen />;
}
