/**
 * Athlete screen transitions: which way a navigation should animate, and
 * whether the browser has already animated it. Pure logic, no React; the
 * component is components/shell/screen-transition.tsx and the motion itself is
 * the `vt-*` CSS in app/globals.css. See docs/athlete-motion.md, "Screen
 * transitions".
 */

/** The class React's <ViewTransition> puts on the screen for one navigation. */
export type ScreenMotion = "push" | "pop" | "tab" | "none";

/** View-transition classes, as globals.css styles them. */
export const SCREEN_CLASS: Record<ScreenMotion, string> = {
  push: "vt-push",
  pop: "vt-pop",
  tab: "vt-tab",
  none: "none",
};

/** The four tab roots. Kept in step with components/ui/tab-bar.tsx by a test. */
export const TAB_ROOTS = ["/today", "/log", "/history", "/me"] as const;

function segments(pathname: string): string[] {
  return pathname.split(/[?#]/)[0].split("/").filter(Boolean);
}

/** The tab a path belongs to ("/history/abc" -> "/history"), or null for a screen outside every tab (/lift/x, /bodyweight). */
export function tabOf(pathname: string): string | null {
  const first = segments(pathname)[0];
  if (!first) return null;
  const root = `/${first}`;
  return (TAB_ROOTS as readonly string[]).includes(root) ? root : null;
}

/**
 * How deep a screen sits in the stack. A tab root is 0 and each segment below
 * it adds one. A screen outside every tab (/lift/[id], /bodyweight) is always
 * reached from inside one, so it counts its own first segment too: /bodyweight
 * is 1, /lift/squat is 2, and opening a lift from a session (/history/abc, 1)
 * still pushes.
 */
export function depthOf(pathname: string): number {
  const n = segments(pathname).length;
  return tabOf(pathname) ? Math.max(0, n - 1) : n;
}

/**
 * The direction model: route depth, not a prop on each link.
 *
 * - Same path (a query or hash change): nothing.
 * - Crossing from one tab's stack into another's: a crossfade. This is a tab
 *   switch whatever the depths, so tapping Today while three screens deep in
 *   History does not play a pop.
 * - Otherwise deeper pushes, shallower pops, and a sideways move at the same
 *   depth (one lift to another) crossfades.
 *
 * Depth was chosen over `transitionTypes` on each <Link> because it needs no
 * change at any call site, covers router.push/back and the browser's own
 * back/forward (which carry no transition type), and cannot be forgotten on
 * the next screen someone adds.
 */
export function classifyNavigation(from: string, to: string): ScreenMotion {
  const a = segments(from).join("/");
  const b = segments(to).join("/");
  if (a === b) return "none";
  const fromTab = tabOf(from);
  const toTab = tabOf(to);
  if (fromTab && toTab && fromTab !== toTab) return "tab";
  const d = depthOf(to) - depthOf(from);
  if (d > 0) return "push";
  if (d < 0) return "pop";
  return "tab";
}

// ---------------------------------------------------------------------------
// Back and forward.
//
// React does not animate them. It renders a transition started inside a
// popstate event synchronously (so the browser can restore scroll), and a
// synchronous commit never starts a view transition; checked in Chromium
// against Next 16.3's bundled React. So back/forward are animated here
// instead, by holding the popstate event until the browser has captured the
// old screen, then handing it on to the router inside the view transition's
// update callback.

export interface UAEnv {
  /** iPhone/iPad, including iPadOS reporting as a Mac. */
  ios: boolean;
  /** Installed to the home screen (no browser chrome, no system swipe-back). */
  standalone: boolean;
}

export function detectEnv(
  nav: (Navigator & { standalone?: boolean }) | undefined = typeof navigator === "undefined" ? undefined : navigator,
  match: ((q: string) => boolean) | undefined = typeof matchMedia === "undefined"
    ? undefined
    : (q) => matchMedia(q).matches,
): UAEnv {
  if (!nav) return { ios: false, standalone: false };
  const ios =
    /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const standalone = nav.standalone === true || (match?.("(display-mode: standalone)") ?? false);
  return { ios, standalone };
}

/**
 * Did the browser already animate this back/forward?
 *
 * `hasUAVisualTransition` (PopStateEvent, NavigateEvent) answers it directly
 * where it exists. Where it does not, an iOS Safari tab is assumed to have
 * animated: its edge swipe is the common way back there, and a skipped
 * animation after a tapped back button costs less than a slide played on top
 * of the swipe that just happened. An installed iOS PWA has no system swipe,
 * so nothing has animated and ours plays.
 */
export function uaAnimatedTraverse(event: { hasUAVisualTransition?: unknown }, env: UAEnv): boolean {
  if (typeof event.hasUAVisualTransition === "boolean") return event.hasUAVisualTransition;
  return env.ios && !env.standalone;
}

/** Marks the copy of a popstate event that is handed on to the router. */
const REPLAYED = Symbol.for("snb.screen-transition.replayed");

type ReplayedPopState = PopStateEvent & { [REPLAYED]?: true };

/** How long the old screen is held, at most, while the router commits the new one. */
export const TRAVERSE_COMMIT_TIMEOUT_MS = 500;

export interface TraversalDeps {
  /** The pathname the athlete screen last committed at, or null before the first. */
  committedPath: () => string | null;
  /** Resolves once the screen has committed `pathname` (or gives up; the caller caps it). */
  waitForCommit: (pathname: string) => Promise<void>;
  /** The element named `athlete-screen` (the shell's <main>), if mounted. */
  screen: () => HTMLElement | null;
  target?: Window;
  doc?: Document;
  env?: UAEnv;
}

type StartViewTransition = (update: () => Promise<void>) => { finished: Promise<unknown> };

/**
 * Animate back/forward between athlete screens. Capture phase on window, so it
 * runs before the Next router's own (bubble-phase) popstate listener and can
 * hold the event back from it. Returns the unsubscribe.
 *
 * It lets the event straight through, unanimated, when: the browser has no
 * view transitions; the traversal lands on the screen already showing (a
 * dialog closing through history, a hash change); the browser drew its own
 * transition (`uaAnimatedTraverse`); or the depth model says "none".
 */
export function animateTraversals(deps: TraversalDeps): () => void {
  const target = deps.target ?? window;
  const doc = deps.doc ?? document;
  const env = deps.env ?? detectEnv();

  const onPopState = (event: ReplayedPopState) => {
    if (event[REPLAYED]) return;
    if (!supportsViewTransitions(doc)) return;
    const from = deps.committedPath();
    const to = target.location.pathname;
    if (from === null || from === to) return;
    if (uaAnimatedTraverse(event, env)) return;
    const motion = classifyNavigation(from, to);
    const screen = deps.screen();
    if (motion === "none" || !screen) return;

    event.stopImmediatePropagation();
    // React names the screen only inside its own view transitions, so it is
    // named here for this one. view-transition-class needs Chrome 125 /
    // Safari 18.2; before that the pair still forms and gets the UA crossfade.
    screen.style.setProperty("view-transition-name", "athlete-screen");
    screen.style.setProperty("view-transition-class", SCREEN_CLASS[motion]);
    const unname = () => {
      screen.style.removeProperty("view-transition-name");
      screen.style.removeProperty("view-transition-class");
    };
    const replay = () => {
      const copy: ReplayedPopState = new PopStateEvent("popstate", { state: event.state });
      copy[REPLAYED] = true;
      target.dispatchEvent(copy);
    };
    const start = (doc as Document & { startViewTransition: StartViewTransition }).startViewTransition.bind(doc);
    try {
      // The update callback always runs, even when the browser skips the
      // animation (hidden tab, another transition starting), so the router
      // always gets its popstate.
      const transition = start(() => {
        replay();
        return Promise.race([
          deps.waitForCommit(to),
          new Promise<void>((resolve) => target.setTimeout(resolve, TRAVERSE_COMMIT_TIMEOUT_MS)),
        ]);
      });
      transition.finished.then(unname, unname);
    } catch {
      unname();
      replay();
    }
  };
  target.addEventListener("popstate", onPopState, true);
  return () => target.removeEventListener("popstate", onPopState, true);
}

/** Does this browser do same-document view transitions at all? */
export function supportsViewTransitions(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  return typeof (doc as (Document & { startViewTransition?: unknown }) | undefined)?.startViewTransition === "function";
}
