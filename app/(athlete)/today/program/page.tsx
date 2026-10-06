import { ProgramScreen } from "./program-screen";

export const metadata = { title: "My program — Sticks N Boulders" };

/**
 * Under Today rather than on the tab bar: four tabs, no more. Reached from a
 * row on Today that only exists for an athlete with a coach.
 */
export default function ProgramPage() {
  return <ProgramScreen />;
}
