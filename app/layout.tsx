import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/lib/auth/session-context";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { SPLASH_SCREENS, splashMedia, splashPath } from "@/lib/pwa/splash";

/** The app background. Also the manifest's, the launch images' and the status bar's. */
const BACKGROUND = "#1d1c22";

// Archivo carries content, IBM Plex Mono carries labels only. Both are loaded
// with the weights the design actually uses -- adding more costs load time, and
// slowness is the first complaint this product exists to answer.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sticks N Boulders",
  description: "Powerlifting coaching software. Programming, logging and video review.",
  applicationName: "Sticks N Boulders",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SnB",
    // iOS only uses a launch image on an exact screen match; without one the
    // launch screen has historically been white. See scripts/pwa-splash.mts.
    startupImage: SPLASH_SCREENS.map((s) => ({ url: splashPath(s), media: splashMedia(s) })),
  },
  // "140" and "2040" are loads and tonnage, not phone numbers.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: BACKGROUND,
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexMono.variable} h-full`}
      // Inline, so the very first paint is dark even before the stylesheet
      // arrives. A white frame on launch reads as a broken app.
      style={{ backgroundColor: BACKGROUND }}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SessionProvider>{children}</SessionProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
