/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Lives in the codebase rather than a test fixture because the palette is
 * split into fill and line tokens specifically to make failing pairs
 * unnameable, and that split is only worth anything if something checks it.
 */

export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`Expected a 6-digit hex colour, got "${hex}"`);
  }
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG 1.4.3. "Large" is 24px at any weight, or 18.66px at 700+, which is why
 * the accent line token is allowed behind the 24px set-row figures and nowhere
 * else.
 */
export function isLargeText(pxSize: number, bold = false): boolean {
  return pxSize >= 24 || (pxSize >= 18.66 && bold);
}

export function meetsAA(fg: string, bg: string, pxSize: number, bold = false): boolean {
  return contrastRatio(fg, bg) >= (isLargeText(pxSize, bold) ? 3 : 4.5);
}
