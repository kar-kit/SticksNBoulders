/**
 * iPhone screens that get a launch image, in CSS points.
 *
 * iOS picks a startup image only on an exact media-query match, so a phone not
 * listed here gets the white launch screen. The target devices are the iPhone
 * 15 Pro and iPhone 16 (both 393x852); the rest are the other current iPhones
 * an athlete is likely to be holding. Android does not use these.
 *
 * Regenerate the images with `npx tsx scripts/pwa-splash.mts` after changing
 * this list.
 */
export interface SplashScreen {
  width: number;
  height: number;
  ratio: number;
  devices: string;
}

export const SPLASH_SCREENS: SplashScreen[] = [
  { width: 393, height: 852, ratio: 3, devices: "iPhone 15, 15 Pro, 16" },
  { width: 402, height: 874, ratio: 3, devices: "iPhone 16 Pro, 17, 17 Pro" },
  { width: 390, height: 844, ratio: 3, devices: "iPhone 12, 13, 14, 16e" },
  { width: 420, height: 912, ratio: 3, devices: "iPhone Air" },
  { width: 430, height: 932, ratio: 3, devices: "iPhone 15 Plus, 15 Pro Max, 16 Plus" },
  { width: 440, height: 956, ratio: 3, devices: "iPhone 16 Pro Max, 17 Pro Max" },
];

export function splashPath(s: SplashScreen): string {
  return `/splash/${s.width * s.ratio}x${s.height * s.ratio}.png`;
}

export function splashMedia(s: SplashScreen): string {
  return (
    `(device-width: ${s.width}px) and (device-height: ${s.height}px) and ` +
    `(-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait)`
  );
}
