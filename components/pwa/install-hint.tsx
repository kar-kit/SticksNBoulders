"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  isInAppBrowser,
  isIos,
  noteVisit,
  recallInstall,
  saveInstall,
  shouldShowHint,
  type InstallPlatform,
} from "@/lib/pwa/install";

/** Chromium's install event. Not in lib.dom, because nobody else ships it. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

function localDate(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/**
 * One small card suggesting the home screen, on Android through the browser's
 * own install prompt and on iOS as the two taps Safari needs.
 *
 * Nothing renders until the rules in lib/pwa/install.ts say so, and on
 * Chromium not until the browser itself has decided the app is installable --
 * which also means it never shows over plain HTTP.
 */
export function InstallHint() {
  const [platform, setPlatform] = useState<InstallPlatform>("none");
  const [visible, setVisible] = useState(false);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const memory = noteVisit(recallInstall(), localDate(new Date()));
    saveInstall(memory);
    const standalone = isStandalone();

    const decide = (next: InstallPlatform) => {
      setPlatform(next);
      setVisible(shouldShowHint(recallInstall(), { platform: next, standalone, now: Date.now() }));
    };

    if (isIos(navigator.userAgent, navigator.maxTouchPoints) && !isInAppBrowser(navigator.userAgent)) {
      decide("ios");
    }

    const onPrompt = (event: Event) => {
      // Holding the event is what lets the card offer the real prompt later,
      // instead of Chrome's own mini-infobar at a moment of its choosing.
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      decide("prompt");
    };
    const onInstalled = () => {
      saveInstall({ ...recallInstall(), installed: true });
      setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    saveInstall({ ...recallInstall(), dismissedAt: Date.now() });
    setVisible(false);
  };

  const install = async () => {
    const event = deferred.current;
    if (!event) return;
    deferred.current = null;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") saveInstall({ ...recallInstall(), installed: true });
    else saveInstall({ ...recallInstall(), dismissedAt: Date.now() });
    setVisible(false);
  };

  return (
    <aside
      aria-label="Add to home screen"
      className="flex flex-col gap-2 rounded-control border border-border bg-surface p-[14px]"
    >
      <span className="text-body font-semibold">Keep it on your home screen</span>
      <p className="m-0 text-sm text-muted">
        {platform === "ios" ? (
          <>
            Opens full screen and works with no signal. Tap <strong className="text-foreground">Share</strong>, then{" "}
            <strong className="text-foreground">Add to Home Screen</strong>.
          </>
        ) : (
          "Opens full screen and works with no signal."
        )}
      </p>
      <div className="flex gap-2">
        {platform === "prompt" ? (
          <Button size="sm" onClick={install}>
            Install
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </aside>
  );
}
