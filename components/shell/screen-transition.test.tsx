/**
 * Runs <ScreenTransition> on the React that the app actually ships: the
 * canary bundled inside Next (next/dist/compiled/react*), which has
 * <ViewTransition>. The plain `react` package vitest would otherwise resolve
 * does not, so this file swaps it in and renders with the matching react-dom
 * rather than Testing Library (which is bound to the plain one).
 */
import * as CanaryReact from "next/dist/compiled/react";
import { createRoot, type Root } from "next/dist/compiled/react-dom/client";
import { act } from "next/dist/compiled/react";

vi.mock("react", async () => await import("next/dist/compiled/react"));

const path = vi.hoisted(() => ({ ctx: null as unknown as import("react").Context<string> }));
vi.mock("next/navigation", async () => {
  const R = await import("next/dist/compiled/react");
  path.ctx = R.createContext("/history") as unknown as typeof path.ctx;
  return { usePathname: () => R.useContext(path.ctx as never) };
});

const { ScreenTransition } = await import("./screen-transition");

type Started = { types: string[] | undefined; name: string; className: string };

/** A stand-in for document.startViewTransition that records what React tagged <main> with. */
function fakeViewTransitions() {
  const started: Started[] = [];
  const doc = document as unknown as Record<string, unknown>;
  // jsdom has no FontFaceSet; React checks it before letting the transition run.
  doc.fonts = { status: "loaded", ready: Promise.resolve() };
  (document.documentElement as unknown as { getAnimations: () => [] }).getAnimations = () => [];
  // React's dev build animates the pseudo-elements through Element.animate.
  (Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    cancel() {},
    finished: Promise.resolve(),
  });
  doc.startViewTransition = ({ update, types }: { update: () => unknown; types?: string[] }) => {
    const main = document.querySelector("main") as HTMLElement & { style: Record<string, string> };
    started.push({
      types,
      name: main?.style.viewTransitionName ?? "",
      className: main?.style.viewTransitionClass ?? "",
    });
    const done = Promise.resolve().then(update);
    return { ready: done, finished: done, updateCallbackDone: done, skipTransition() {} };
  };
  return started;
}

let root: Root;
let container: HTMLDivElement;
let navigate: (to: string) => void;
let bump: () => void;

function Harness() {
  const [p, setP] = CanaryReact.useState("/history");
  const [n, setN] = CanaryReact.useState(0);
  CanaryReact.useEffect(() => {
    navigate = (to) => CanaryReact.startTransition(() => setP(to));
    // A transition inside the screen that is not a navigation (a Suspense
    // reveal, a useTransition in a page).
    bump = () => CanaryReact.startTransition(() => setN((x: number) => x + 1));
  }, []);
  return (
    <path.ctx.Provider value={p}>
      <ScreenTransition>
        <main>
          <p>{p}</p>
          <span>{n}</span>
        </main>
      </ScreenTransition>
    </path.ctx.Provider>
  );
}

async function go(to: string) {
  await act(async () => {
    navigate(to);
  });
  // Let the fake transition's update callback and React's follow-up settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  delete (Element.prototype as { animate?: unknown }).animate;
});

describe("ScreenTransition", () => {
  it("falls back to an instant switch where the browser has no view transitions", async () => {
    expect("startViewTransition" in document).toBe(false);
    await go("/history/s1");
    expect(container.querySelector("p")?.textContent).toBe("/history/s1");
    await go("/history");
    expect(container.querySelector("p")?.textContent).toBe("/history");
  });

  it("slides in on a drill-in and back out on the way up", async () => {
    const started = fakeViewTransitions();
    await go("/history/s1");
    await go("/history");
    expect(container.querySelector("p")?.textContent).toBe("/history");
    expect(started.map((s) => s.className)).toEqual(["vt-push", "vt-pop"]);
    expect(started.every((s) => s.name === "athlete-screen")).toBe(true);
  });

  it("crossfades between tabs", async () => {
    const started = fakeViewTransitions();
    await go("/today");
    expect(started.map((s) => s.className)).toEqual(["vt-tab"]);
  });

  it("does not replay the slide on a later transition inside the same screen", async () => {
    const started = fakeViewTransitions();
    await go("/history/s1");
    await act(async () => bump());
    await act(async () => bump());
    expect(container.querySelector("span")?.textContent).toBe("2");
    expect(started.map((s) => s.className).filter(Boolean)).toEqual(["vt-push"]);
  });
});
