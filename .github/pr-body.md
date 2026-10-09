## feat(coach): scale the coach side up 20% for laptops at 100% zoom

Joey, looking at the program editor on a laptop at 100% Chrome zoom: the coach side reads as small print. The type scale is px (10px labels, 14px UI) and `@theme inline` bakes each value into its utility, so it can't be re-pointed for one section.

The coach shell now carries a `coach-scale` utility: `zoom: 1.2`, which scales type, spacing and borders together. The athlete side is phone-first and untouched.

Under standardised zoom a viewport unit inside the zoomed box is multiplied too, so the shell's `min-height` is `100dvh / 1.2`; without that every coach page would scroll by a fifth of a screen.

Effect: 14px UI reads at ~17px, 10px labels at 12px. A 1440px laptop lays the coach side out as ~1200 CSS px wide; the program editor redesign (separate PR) is built for that width.

To change the factor: `--coach-zoom` in `app/globals.css`.

### Checks
- `npx vitest run`, `npx eslint .`, `npx next build --webpack`, `npx tsc --noEmit`
- Checked by eye on the dev server: not yet (Joey).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
