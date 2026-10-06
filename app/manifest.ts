import type { MetadataRoute } from "next";

/**
 * The install manifest. Checked by `npm run e2e:pwa`, which loads every icon and
 * confirms its real size matches the size claimed here.
 *
 * - `id` pins the app's identity, so changing start_url later does not make
 *   Chrome treat it as a second app.
 * - Colours are the app background, so Android's generated splash and the
 *   status bar match the first frame of the app. No white flash.
 * - The maskable icon keeps the mark inside the central 80% safe zone; the
 *   plain icons are for launchers that do not mask.
 * - start_url is `/`, which routes a coach to their roster and an athlete to
 *   Today, and works offline from the service worker's cached shell.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Sticks N Boulders",
    short_name: "SnB",
    description: "Powerlifting coaching software. Programming, logging and video review.",
    lang: "en-GB",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1d1c22",
    theme_color: "#1d1c22",
    categories: ["health", "fitness", "sports"],
    prefer_related_applications: false,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
