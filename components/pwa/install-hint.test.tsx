import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InstallHint } from "./install-hint";
import { INSTALL_KEY, recallInstall } from "@/lib/pwa/install";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S721B) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36";

const setAgent = (ua: string) => vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
const seenYesterday = () =>
  localStorage.setItem(INSTALL_KEY, JSON.stringify({ days: ["2000-1-1"], dismissedAt: null, installed: false }));

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
});
afterEach(() => vi.restoreAllMocks());

it("renders nothing on the first day", () => {
  setAgent(IPHONE);
  render(<InstallHint />);
  expect(screen.queryByRole("complementary", { name: "Add to home screen" })).toBeNull();
});

it("tells an iPhone the two taps, from the second day", () => {
  setAgent(IPHONE);
  seenYesterday();
  render(<InstallHint />);
  expect(screen.getByRole("complementary", { name: "Add to home screen" })).toHaveTextContent(
    "Tap Share, then Add to Home Screen",
  );
  expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
});

it("says nothing on the home screen itself", () => {
  setAgent(IPHONE);
  seenYesterday();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
  render(<InstallHint />);
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("remembers Not now", async () => {
  setAgent(IPHONE);
  seenYesterday();
  render(<InstallHint />);
  await userEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(recallInstall().dismissedAt).not.toBeNull();
});

it("on Android waits for the browser to say it is installable, then offers its prompt", async () => {
  setAgent(ANDROID);
  seenYesterday();
  render(<InstallHint />);
  expect(screen.queryByRole("complementary")).toBeNull();

  const prompt = vi.fn(async () => {});
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: "accepted" as const }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "Install" }));
  expect(prompt).toHaveBeenCalledOnce();
  expect(recallInstall().installed).toBe(true);
  expect(screen.queryByRole("complementary")).toBeNull();
});
