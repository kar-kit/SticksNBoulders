import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sticks N Boulders",
    short_name: "SnB",
    description: "Powerlifting coaching software. Programming, logging and video review.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1d1c22",
    theme_color: "#1d1c22",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
