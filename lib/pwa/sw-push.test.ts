// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { collapsedTitle as appCollapsedTitle, clipMessage, replyMessage, type PushMessage } from "@/lib/push/message";

/**
 * public/sw.js's push half (F27), run as the browser would run it: the real
 * file, evaluated with a fake `self`. It has no build step, so this is the
 * only place its logic is held to lib/push/message.ts.
 */

const SOURCE = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
const ORIGIN = "https://snb.test";

interface FakeNotification {
  title: string;
  tag: string;
  data: { url: string; keys: string[]; kind: string };
  body: string;
  renotify: boolean;
  close: () => void;
}

interface FakeClient {
  url: string;
  focused: boolean;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}

function loadWorker(clients: FakeClient[] = []) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: FakeNotification[] = [];
  const openWindow = vi.fn(async (url: string) => ({ url }));
  const self = {
    location: new URL(`${ORIGIN}/sw.js?v=build1`),
    addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] = fn),
    registration: {
      getNotifications: async ({ tag }: { tag: string }) => shown.filter((n) => n.tag === tag),
      showNotification: async (title: string, options: Omit<FakeNotification, "title" | "close">) => {
        // Same tag replaces, as the browser does.
        const at = shown.findIndex((n) => n.tag === options.tag);
        if (at >= 0) shown.splice(at, 1);
        shown.push({ title, ...options, close: () => {} });
      },
    },
    clients: { matchAll: async () => clients, openWindow },
  };
  const context = vm.createContext({ self, URL, Date, Math, JSON, Promise, Set, setTimeout, caches: {}, fetch: () => {} });
  vm.runInContext(SOURCE, context);
  const sw = context as unknown as {
    collapse: (existing: unknown, message: PushMessage) => { title: string; options: Record<string, unknown> };
    readPushMessage: (data: unknown) => PushMessage;
    collapsedTitle: (kind: string, who: string, count: number) => string;
  };

  async function push(message: unknown) {
    let done: Promise<unknown> = Promise.resolve();
    listeners.push({ data: { json: () => message }, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }
  async function click(data: unknown) {
    let done: Promise<unknown> = Promise.resolve();
    const close = vi.fn();
    listeners.notificationclick({ notification: { data, close }, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    return close;
  }
  return { listeners, shown, openWindow, sw, push, click };
}

const clip = (setId: string, videoFileId = `f-${setId}`) =>
  clipMessage({ athleteId: "athlete_a", athleteName: "Joey", setId, videoFileId, exerciseName: "Squat" });

describe("the service worker, still a cache", () => {
  it("keeps its install, activate and fetch handlers beside the new ones", () => {
    const { listeners } = loadWorker();
    expect(Object.keys(listeners).sort()).toEqual(["activate", "fetch", "install", "notificationclick", "push"]);
  });
});

describe("push: collapse per athlete", () => {
  it("shows one clip as itself, opening that clip", async () => {
    const w = loadWorker();
    await w.push(clip("set1"));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]).toMatchObject({ title: "Joey uploaded a clip", tag: "clips:athlete_a", renotify: true });
    expect(w.shown[0].data.url).toBe("/coach/athletes/athlete_a?clip=set1");
  });

  it("turns six clips from one session into one notification that counts them", async () => {
    const w = loadWorker();
    for (let i = 1; i <= 6; i += 1) await w.push(clip(`set${i}`));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("Joey uploaded 6 clips");
    expect(w.shown[0].data.url).toBe("/coach/review");
    expect(w.shown[0].renotify).toBe(true);
  });

  it("replaces quietly when the same clip is reported twice", async () => {
    const w = loadWorker();
    await w.push(clip("set1"));
    await w.push(clip("set2"));
    await w.push(clip("set2"));
    expect(w.shown[0].title).toBe("Joey uploaded 2 clips");
    expect(w.shown[0].renotify).toBe(false);
  });

  it("counts a replaced clip on the same set as new", async () => {
    const w = loadWorker();
    await w.push(clip("set1", "a"));
    await w.push(clip("set1", "b"));
    expect(w.shown[0].title).toBe("Joey uploaded 2 clips");
  });

  it("keeps clips and replies, and different athletes, apart", async () => {
    const w = loadWorker();
    await w.push(clip("set1"));
    await w.push(replyMessage({ athleteId: "athlete_a", athleteName: "Joey", setId: "set1", commentId: "c1", body: "ok" }));
    await w.push(clipMessage({ athleteId: "athlete_b", athleteName: "Sam", setId: "s9", videoFileId: "f9", exerciseName: null }));
    expect(w.shown.map((n) => n.tag).sort()).toEqual(["clips:athlete_a", "clips:athlete_b", "replies:athlete_a"]);
  });

  it("agrees with the app on every collapsed title", () => {
    const { sw } = loadWorker();
    for (const kind of ["clip", "reply", "test"] as const) {
      for (const n of [1, 2, 7]) expect(sw.collapsedTitle(kind, "Joey", n)).toBe(appCollapsedTitle(kind, "Joey", n));
    }
  });

  it("still shows something for a malformed push, because Safari drops a site whose pushes show nothing", async () => {
    const w = loadWorker();
    await w.push({ hello: "world" });
    await w.push(null);
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("Sticks N Boulders");
  });

  it("never carries a link off this origin", () => {
    const { sw } = loadWorker();
    const evil = sw.readPushMessage({ json: () => ({ ...clip("set1"), url: "https://evil.io", groupUrl: "//evil.io" }) });
    expect(evil.url).toBe("/");
    expect(evil.groupUrl).toBe("/");
  });
});

describe("notificationclick", () => {
  const client = (url: string, focused = false): FakeClient => {
    const c: FakeClient = { url, focused, focus: vi.fn(), navigate: vi.fn() };
    c.focus.mockImplementation(async () => c);
    c.navigate.mockImplementation(async () => c);
    return c;
  };

  it("focuses a window already on the target, without reloading it", async () => {
    const there = client(`${ORIGIN}/coach/athletes/athlete_a?clip=set1`);
    const w = loadWorker([client(`${ORIGIN}/coach/roster`), there]);
    const close = await w.click({ url: "/coach/athletes/athlete_a?clip=set1" });
    expect(close).toHaveBeenCalled();
    expect(there.focus).toHaveBeenCalled();
    expect(there.navigate).not.toHaveBeenCalled();
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it("focuses an open window and takes it to the target", async () => {
    const open = client(`${ORIGIN}/coach/roster`, true);
    const w = loadWorker([open]);
    await w.click({ url: "/coach/review" });
    expect(open.focus).toHaveBeenCalled();
    expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/coach/review`);
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it("opens a window when there is none, or when the open one cannot be navigated", async () => {
    expect((await (async () => {
      const w = loadWorker([]);
      await w.click({ url: "/coach/review" });
      return w.openWindow;
    })())).toHaveBeenCalledWith(`${ORIGIN}/coach/review`);

    const stuck = client(`${ORIGIN}/me`);
    stuck.navigate.mockRejectedValue(new TypeError("not controlled"));
    const w = loadWorker([stuck]);
    await w.click({ url: "/coach/review" });
    expect(w.openWindow).toHaveBeenCalledWith(`${ORIGIN}/coach/review`);
  });

  it("goes home rather than off-site for a bad link", async () => {
    const w = loadWorker([]);
    await w.click({ url: "https://evil.io/phish" });
    expect(w.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});
