/**
 * Prints the athlete's spring easings for globals.css (docs/athlete-motion.md).
 *
 *   npx tsx scripts/spring-easings.mts
 *
 * Paste the `--ease-*` lines into the `@supports (linear())` block and the
 * durations into `@theme static`. lib/ui/spring.test.ts fails until they match.
 */
import { SPRINGS, springEasing } from "../lib/ui/spring";

for (const [name, spring] of Object.entries(SPRINGS)) {
  const { easing, ms } = springEasing(spring);
  console.log(`/* response ${spring.response}s, damping ${spring.damping}; settles in ${ms}ms */`);
  console.log(`--ease-${name}: ${easing};`);
}
