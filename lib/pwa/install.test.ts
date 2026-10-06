import { beforeEach, expect, it } from "vitest";
import {
  DISMISS_DAYS,
  INSTALL_KEY,
  isInAppBrowser,
  isIos,
  noteVisit,
  recallInstall,
  saveInstall,
  shouldShowHint,
  type InstallMemory,
} from "./install";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 1);
const TWO_DAYS: InstallMemory = { days: ["2026-9-30", "2026-10-1"], dismissedAt: null, installed: false };

beforeEach(() => localStorage.clear());

it("never asks on the first day", () => {
  const memory = noteVisit(recallInstall(), "2026-10-1");
  expect(shouldShowHint(memory, { platform: "ios", standalone: false, now: NOW })).toBe(false);
});

it("asks from the second day the app is opened", () => {
  expect(shouldShowHint(TWO_DAYS, { platform: "ios", standalone: false, now: NOW })).toBe(true);
  expect(shouldShowHint(TWO_DAYS, { platform: "prompt", standalone: false, now: NOW })).toBe(true);
});

it("counts days, not opens", () => {
  let memory = recallInstall();
  for (let i = 0; i < 10; i++) memory = noteVisit(memory, "2026-10-1");
  expect(memory.days).toEqual(["2026-10-1"]);
});

it("keeps at most two days", () => {
  let memory = recallInstall();
  for (const d of ["a", "b", "c", "d"]) memory = noteVisit(memory, d);
  expect(memory.days).toEqual(["c", "d"]);
});

it("never asks from the home screen itself", () => {
  expect(shouldShowHint(TWO_DAYS, { platform: "ios", standalone: true, now: NOW })).toBe(false);
});

it("never asks once installed", () => {
  expect(shouldShowHint({ ...TWO_DAYS, installed: true }, { platform: "prompt", standalone: false, now: NOW })).toBe(false);
});

it("never asks where installing is not possible", () => {
  expect(shouldShowHint(TWO_DAYS, { platform: "none", standalone: false, now: NOW })).toBe(false);
});

it("stays quiet for the dismiss window, then asks once more", () => {
  const dismissed = { ...TWO_DAYS, dismissedAt: NOW };
  const ctx = { platform: "ios" as const, standalone: false };
  expect(shouldShowHint(dismissed, { ...ctx, now: NOW + (DISMISS_DAYS - 1) * DAY })).toBe(false);
  expect(shouldShowHint(dismissed, { ...ctx, now: NOW + DISMISS_DAYS * DAY })).toBe(true);
});

it("round-trips through storage and survives junk in it", () => {
  saveInstall({ ...TWO_DAYS, dismissedAt: 5 });
  expect(recallInstall()).toEqual({ ...TWO_DAYS, dismissedAt: 5 });
  localStorage.setItem(INSTALL_KEY, JSON.stringify({ days: "nope", dismissedAt: "x", installed: "yes" }));
  expect(recallInstall()).toEqual({ days: [], dismissedAt: null, installed: false });
});

it("recognises an iPhone, and an iPad pretending to be a Mac", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
  const s24 = "Mozilla/5.0 (Linux; Android 14; SM-S721B) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36";
  expect(isIos(iphone, 5)).toBe(true);
  expect(isIos(ipad, 5)).toBe(true);
  expect(isIos(ipad, 0)).toBe(false); // an actual Mac
  expect(isIos(s24, 5)).toBe(false);
});

it("does not send someone in Instagram's browser looking for a Share button that cannot help", () => {
  expect(isInAppBrowser("Mozilla/5.0 (iPhone...) Mobile/15E148 Instagram 350.0")).toBe(true);
  expect(isInAppBrowser("Mozilla/5.0 (iPhone...) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
});
