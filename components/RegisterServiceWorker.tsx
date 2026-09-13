"use client";

import { useEffect } from "react";

export default function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installability is a progressive enhancement; a failed registration
        // (e.g. unsupported browser) shouldn't block the app from working.
      });
    }
  }, []);

  return null;
}
