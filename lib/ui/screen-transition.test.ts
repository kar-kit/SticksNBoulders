import {
  SCREEN_CLASS,
  TAB_ROOTS,
  TRAVERSE_COMMIT_TIMEOUT_MS,
  animateTraversals,
  classifyNavigation,
  depthOf,
  detectEnv,
  supportsViewTransitions,
  tabOf,
  uaAnimatedTraverse,
} from "./screen-transition";

describe("tabOf / depthOf", () => {
  it("finds the owning tab, or none outside the four", () => {
    expect(tabOf("/history")).toBe("/history");
    expect(tabOf("/history/s1")).toBe("/history");
    expect(tabOf("/today/program")).toBe("/today");
    expect(tabOf("/lift/squat")).toBeNull();
    expect(tabOf("/bodyweight")).toBeNull();
    expect(tabOf("/")).toBeNull();
    // A prefix is not a tab: /logs is not /log.
    expect(tabOf("/logs")).toBeNull();
  });

  it("counts a tab root as 0 and a screen outside the tabs from its first segment", () => {
    expect(depthOf("/today")).toBe(0);
    expect(depthOf("/history/s1")).toBe(1);
    expect(depthOf("/me/exercises")).toBe(1);
    expect(depthOf("/bodyweight")).toBe(1);
    expect(depthOf("/lift/squat")).toBe(2);
    expect(depthOf("/history/s1/")).toBe(1);
  });
});

describe("classifyNavigation", () => {
  it.each([
    // Drill in.
    ["/history", "/history/s1", "push"],
    ["/today", "/today/program", "push"],
    ["/today", "/today/feedback", "push"],
    ["/me", "/me/exercises", "push"],
    ["/me", "/bodyweight", "push"],
    ["/history/s1", "/lift/squat", "push"],
    ["/today", "/lift/bench", "push"],
    // Back out, by link, router.back() or the browser.
    ["/history/s1", "/history", "pop"],
    ["/lift/squat", "/history/s1", "pop"],
    ["/bodyweight", "/me", "pop"],
    ["/today/program", "/today", "pop"],
    // Tab switches crossfade, from a root or from deep in another tab's stack.
    ["/today", "/log", "tab"],
    ["/log", "/history", "tab"],
    ["/history/s1", "/today", "tab"],
    ["/today", "/history/s1", "tab"],
    // Sideways at one depth.
    ["/lift/squat", "/lift/bench", "tab"],
    ["/today/program", "/today/feedback", "tab"],
    // Nothing moved.
    ["/history", "/history", "none"],
    ["/history", "/history/", "none"],
  ] as const)("%s -> %s is %s", (from, to, motion) => {
    expect(classifyNavigation(from, to)).toBe(motion);
  });

  it("pops back to a tab root from a screen outside the tabs", () => {
    // A tab tapped from Lift Detail: there is no other tab's stack to cross
    // into, so it reads as going back up.
    expect(classifyNavigation("/lift/squat", "/today")).toBe("pop");
  });

  it("reverses: every push read backwards is a pop", () => {
    const pairs: [string, string][] = [
      ["/history", "/history/s1"],
      ["/history/s1", "/lift/squat"],
      ["/me", "/bodyweight"],
    ];
    for (const [a, b] of pairs) {
      expect(classifyNavigation(a, b)).toBe("push");
      expect(classifyNavigation(b, a)).toBe("pop");
    }
  });

  it("maps every motion to a class, and none to React's none", () => {
    expect(SCREEN_CLASS).toEqual({ push: "vt-push", pop: "vt-pop", tab: "vt-tab", none: "none" });
  });

  it("knows the same four tabs as the tab bar", () => {
    expect([...TAB_ROOTS]).toEqual(["/today", "/log", "/history", "/me"]);
  });
});

describe("back/forward the browser already animated", () => {
  const safariTab = { ios: true, standalone: false };
  const homeScreen = { ios: true, standalone: true };
  const android = { ios: false, standalone: true };

  it("trusts hasUAVisualTransition wherever the browser reports it", () => {
    expect(uaAnimatedTraverse({ hasUAVisualTransition: true }, android)).toBe(true);
    expect(uaAnimatedTraverse({ hasUAVisualTransition: false }, android)).toBe(false);
    // Reported false in a Safari tab (a tapped back button): ours plays.
    expect(uaAnimatedTraverse({ hasUAVisualTransition: false }, safariTab)).toBe(false);
  });

  it("without it, assumes a Safari tab swiped and an installed PWA did not", () => {
    expect(uaAnimatedTraverse({}, safariTab)).toBe(true);
    expect(uaAnimatedTraverse({}, homeScreen)).toBe(false);
    expect(uaAnimatedTraverse({}, { ios: false, standalone: false })).toBe(false);
  });

});

describe("animateTraversals (back/forward)", () => {
  const homeScreen = { ios: true, standalone: true };
  const safariTab = { ios: true, standalone: false };
  let screen: HTMLElement;
  let committed: string | null;
  let routerSaw: string[];
  let started: { cls: string; name: string }[];
  let finish: () => void;
  const router = () => routerSaw.push(`${location.pathname}:${screen.style.getPropertyValue("view-transition-class")}`);

  function fakeDoc(): Document {
    return {
      startViewTransition(update: () => Promise<void>) {
        started.push({
          cls: screen.style.getPropertyValue("view-transition-class"),
          name: screen.style.getPropertyValue("view-transition-name"),
        });
        const done = update();
        const finished = new Promise<void>((resolve) => (finish = resolve));
        return { updateCallbackDone: done, finished };
      },
    } as unknown as Document;
  }

  beforeEach(() => {
    screen = document.createElement("main");
    committed = "/history/s1";
    routerSaw = [];
    started = [];
    window.addEventListener("popstate", router);
  });
  afterEach(() => window.removeEventListener("popstate", router));

  function back(to: string, init: { hasUAVisualTransition?: boolean } = {}) {
    window.history.replaceState({}, "", to);
    const event = new PopStateEvent("popstate", { state: { __NA: true } });
    if ("hasUAVisualTransition" in init) {
      Object.defineProperty(event, "hasUAVisualTransition", { value: init.hasUAVisualTransition });
    }
    window.dispatchEvent(event);
  }

  function watch(doc: Document, env = homeScreen) {
    return animateTraversals({
      committedPath: () => committed,
      waitForCommit: async () => {},
      screen: () => screen,
      doc,
      env,
    });
  }

  it("pops on back: holds the event, names the screen, then hands the router a copy inside the transition", async () => {
    const stop = watch(fakeDoc());
    back("/history", { hasUAVisualTransition: false });
    expect(started).toEqual([{ cls: "vt-pop", name: "athlete-screen" }]);
    // The router got exactly one popstate, the replayed copy, while the
    // screen was named for the transition.
    expect(routerSaw).toEqual(["/history:vt-pop"]);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getAttribute("style") ?? "").toBe("");
    stop();
  });

  it("pushes on forward", () => {
    committed = "/history";
    const stop = watch(fakeDoc());
    back("/history/s1");
    expect(started.map((s) => s.cls)).toEqual(["vt-push"]);
    expect(routerSaw).toHaveLength(1);
    stop();
  });

  it("leaves a traversal the browser animated to the browser", () => {
    const stop = watch(fakeDoc(), safariTab);
    back("/history", { hasUAVisualTransition: true });
    back("/history"); // No property, Safari tab: assumed swiped.
    expect(started).toEqual([]);
    expect(routerSaw).toEqual(["/history:", "/history:"]);
    stop();
  });

  it("does nothing for a popstate that lands on the screen already showing", () => {
    committed = "/history";
    const stop = watch(fakeDoc());
    back("/history");
    expect(started).toEqual([]);
    expect(routerSaw).toHaveLength(1);
    stop();
  });

  it("does nothing before the first screen has committed, or without a screen", () => {
    committed = null;
    const stop = watch(fakeDoc());
    back("/history");
    expect(started).toEqual([]);
    stop();
  });

  it("falls back to the plain popstate where the browser has no view transitions", () => {
    const stop = watch({} as Document);
    back("/history");
    expect(started).toEqual([]);
    expect(routerSaw).toEqual(["/history:"]);
    stop();
  });

  it("still hands the router its popstate if startViewTransition throws", () => {
    const doc = {
      startViewTransition() {
        throw new TypeError("options form not supported");
      },
    } as unknown as Document;
    const stop = watch(doc);
    back("/history");
    expect(routerSaw).toEqual(["/history:"]);
    expect(screen.getAttribute("style") ?? "").toBe("");
    stop();
  });

  it("stops holding the old screen if the commit never comes", async () => {
    vi.useFakeTimers();
    let settled = false;
    const doc = {
      startViewTransition(update: () => Promise<void>) {
        update().then(() => (settled = true));
        return { finished: new Promise(() => {}) };
      },
    } as unknown as Document;
    const stop = animateTraversals({
      committedPath: () => committed,
      waitForCommit: () => new Promise(() => {}),
      screen: () => screen,
      doc,
      env: homeScreen,
    });
    back("/history");
    await vi.advanceTimersByTimeAsync(TRAVERSE_COMMIT_TIMEOUT_MS);
    expect(settled).toBe(true);
    stop();
    vi.useRealTimers();
  });

  it("unsubscribes", () => {
    const stop = watch(fakeDoc());
    stop();
    back("/history");
    expect(started).toEqual([]);
    expect(routerSaw).toHaveLength(1);
  });
});

describe("detectEnv", () => {
  const nav = (userAgent: string, extra: Partial<Navigator & { standalone: boolean }> = {}) =>
    ({ userAgent, platform: "", maxTouchPoints: 0, ...extra }) as Navigator & { standalone?: boolean };

  it("spots an iPhone, an iPad passing as a Mac, and the home-screen app", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
    expect(detectEnv(nav(iphone), () => false)).toEqual({ ios: true, standalone: false });
    expect(detectEnv(nav(iphone, { standalone: true }), () => false)).toEqual({ ios: true, standalone: true });
    expect(detectEnv(nav("Macintosh", { platform: "MacIntel", maxTouchPoints: 5 }), () => false).ios).toBe(true);
    expect(detectEnv(nav("Macintosh", { platform: "MacIntel", maxTouchPoints: 0 }), () => false).ios).toBe(false);
    const pixel = "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141";
    expect(detectEnv(nav(pixel), (q) => q === "(display-mode: standalone)")).toEqual({ ios: false, standalone: true });
  });

  it("is safe without a navigator", () => {
    expect(detectEnv(undefined, undefined)).toEqual({ ios: false, standalone: false });
  });
});

describe("supportsViewTransitions", () => {
  it("is false where document.startViewTransition is missing (jsdom, Safari < 18, iOS 17)", () => {
    expect(supportsViewTransitions(document)).toBe(false);
    expect(supportsViewTransitions(undefined)).toBe(false);
  });

  it("is true where it exists", () => {
    const doc = { startViewTransition: () => ({}) } as unknown as Document;
    expect(supportsViewTransitions(doc)).toBe(true);
  });
});
