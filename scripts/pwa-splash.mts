/**
 * Generates the iOS launch images in public/splash/, and the 192px maskable
 * icon from the 512px one (Android picks the nearest size, and downscaling a
 * 512 on the device is a blurrier 192 than this).
 *
 *   npx tsx scripts/pwa-splash.mts
 *
 * iOS does not build a launch screen from the manifest the way Android does. It
 * shows an apple-touch-startup-image whose media query matches the phone
 * exactly, and otherwise a plain screen that has historically been white -- on
 * a dark app, a white flash on every cold start. [Unverified on iOS 18/26:
 * confirm on a real iPhone once the app is on HTTPS.] So: one image per current
 * iPhone screen, the mark centred on the app background.
 *
 * Android builds its splash from the manifest (background_color + icon) and
 * needs none of this.
 *
 * sharp arrives with Next; this is a one-off, run when the logo or the device
 * list changes, and the output is committed. Keep SPLASH_SCREENS in step with
 * app/layout.tsx, which imports it.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { SPLASH_SCREENS, splashPath } from "../lib/pwa/splash";

const BACKGROUND = "#1d1c22";
const MARK = "public/mark-transparent.png";

await mkdir("public/splash", { recursive: true });

for (const screen of SPLASH_SCREENS) {
  const width = screen.width * screen.ratio;
  const height = screen.height * screen.ratio;
  // The same proportion the maskable icon uses, so launch and icon line up.
  const markWidth = Math.round(width * 0.42);
  const mark = await sharp(MARK).resize({ width: markWidth }).toBuffer();
  const out = `public${splashPath(screen)}`;
  await sharp({ create: { width, height, channels: 3, background: BACKGROUND } })
    .composite([{ input: mark, gravity: "center" }])
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(out);
  console.log(`  ${out}  ${width}x${height}`);
}

await sharp("public/icon-512-maskable.png").resize(192, 192).png({ compressionLevel: 9 }).toFile("public/icon-192-maskable.png");
console.log("  public/icon-192-maskable.png  192x192");
