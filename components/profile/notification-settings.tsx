"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_PUSH_PREFS, type PushPrefs } from "@/appwrite/documents/push";
import type { PushAvailability } from "@/lib/push/availability";
import {
  currentSubscription,
  detectPushAvailability,
  disablePush,
  enablePush,
  readMyPushPrefs,
  savePushPrefs,
  sendTestPush,
} from "@/lib/push/push-store";

/**
 * NOTIFICATIONS, coach side (F27): hear about a new clip or an athlete's
 * reply without opening the app.
 *
 * Per device, because a push subscription is: turning it on here says
 * nothing about the laptop. The two switches are the coach's, and apply to
 * every device they have on.
 *
 * The permission prompt only ever comes from the button, never on load: a
 * browser that is asked unprompted remembers the "no" for good, and Safari
 * will not show the prompt without a tap at all.
 */

type Device = "checking" | "off" | "on";

const TYPES: ReadonlyArray<{ key: keyof PushPrefs; label: string; hint: string }> = [
  { key: "clips", label: "New clips", hint: "An athlete puts a video on a set." },
  { key: "replies", label: "Athlete replies", hint: "An athlete answers in a thread." },
];

export function NotificationSettings({ userId }: { userId: string }) {
  const [availability, setAvailability] = useState<PushAvailability | null>(null);
  const [device, setDevice] = useState<Device>("checking");
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PUSH_PREFS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Browser facts, so read here rather than during a render the server
      // also runs.
      const found = detectPushAvailability();
      const ready = found.kind === "ready";
      const [subscription, stored] = await Promise.all([
        ready ? currentSubscription().catch(() => null) : null,
        ready ? readMyPushPrefs(userId).catch(() => null) : null,
      ]);
      if (cancelled) return;
      setAvailability(found);
      if (!ready) return;
      if (stored) setPrefs(stored.prefs);
      // On only if the browser has a subscription AND the server knows it: a
      // subscription the server lost (removed after a 410) is not delivering.
      const known = Boolean(subscription && stored?.endpoints.includes(subscription.endpoint));
      setDevice(known && found.permission === "granted" ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!availability) return null;

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await enablePush();
      if (result.status === "on") {
        setPrefs(result.prefs);
        setDevice("on");
      } else if (result.status === "denied") {
        setAvailability({ kind: "denied" });
      } else {
        setNote("Nothing changed. Tap again and choose Allow.");
      }
    } catch {
      setNote("Couldn’t turn notifications on. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setNote(null);
    try {
      await disablePush();
      setDevice("off");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (key: keyof PushPrefs) => {
    const previous = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setNote(null);
    try {
      await savePushPrefs(next);
    } catch {
      setPrefs(previous);
      setNote("Couldn’t save that. Try again.");
    }
  };

  const test = async () => {
    setBusy(true);
    setNote(null);
    try {
      const { delivered } = await sendTestPush();
      setNote(delivered > 0 ? "Sent. It should appear in a few seconds." : "Nothing was delivered. Turn this device off and on again.");
    } catch {
      setNote("Couldn’t send a test right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="notifications-heading">
      <h2 id="notifications-heading" className="m-0 text-ui font-semibold text-muted">
        Notifications
      </h2>
      <Body
        availability={availability}
        device={device}
        prefs={prefs}
        busy={busy}
        onOn={turnOn}
        onOff={turnOff}
        onToggle={toggle}
        onTest={test}
      />
      {note ? (
        <p role="status" className="m-0 text-ui text-muted">
          {note}
        </p>
      ) : null}
    </section>
  );
}

function Body({
  availability,
  device,
  prefs,
  busy,
  onOn,
  onOff,
  onToggle,
  onTest,
}: {
  availability: PushAvailability;
  device: Device;
  prefs: PushPrefs;
  busy: boolean;
  onOn: () => void;
  onOff: () => void;
  onToggle: (key: keyof PushPrefs) => void;
  onTest: () => void;
}) {
  switch (availability.kind) {
    case "unconfigured":
      return <p className="m-0 text-body text-muted">Notifications aren’t set up for this app yet.</p>;
    case "ios-install":
      return (
        <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
          <p className="m-0 text-body">On iPhone, notifications only work from the Home Screen app.</p>
          <ol className="m-0 flex flex-col gap-1 pl-5 text-body text-muted">
            <li>Tap the Share button in Safari.</li>
            <li>Choose Add to Home Screen.</li>
            <li>Open Sticks N Boulders from the new icon and come back here.</li>
          </ol>
          <p className="m-0 text-ui text-muted-2">Needs iOS 16.4 or later.</p>
        </div>
      );
    case "unsupported":
      return (
        <p className="m-0 text-body text-muted">
          {availability.ios
            ? "This iPhone can’t receive notifications from web apps. Update to iOS 16.4 or later."
            : "This browser can’t receive notifications. Chrome, Edge, Firefox and Safari can."}
        </p>
      );
    case "denied":
      return (
        <p className="m-0 text-body text-muted">
          Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.
        </p>
      );
    case "ready":
      break;
  }

  if (device === "checking") {
    return (
      <p className="m-0 text-body text-muted" aria-busy>
        Checking this device…
      </p>
    );
  }

  if (device === "off") {
    return (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-body text-muted">Get a notification when an athlete uploads a clip or replies to you.</p>
        <Button onClick={onOn} disabled={busy}>
          Turn on notifications
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {TYPES.map((type) => (
        <label
          key={type.key}
          className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2.5"
        >
          <span className="flex flex-col">
            <span className="text-body">{type.label}</span>
            <span className="text-ui text-muted-2">{type.hint}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={prefs[type.key]}
            checked={prefs[type.key]}
            onChange={() => onToggle(type.key)}
            className="h-5 w-5 shrink-0 accent-accent-fill"
          />
        </label>
      ))}
      <div className="flex gap-2">
        <Button variant="secondary" block onClick={onTest} disabled={busy}>
          Send a test
        </Button>
        <Button variant="ghost" block onClick={onOff} disabled={busy}>
          Turn off on this device
        </Button>
      </div>
    </div>
  );
}
