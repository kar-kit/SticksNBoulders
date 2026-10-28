import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import type { SessionSummary } from "@/lib/logging/session";
import type { SessionPr } from "@/lib/strength/pr";
import { HAPTICS } from "@/lib/ui/haptics";
import { FinishedSummary } from "./finished-summary";

/**
 * F22. jsdom loads no stylesheet, so nothing here sees a frame move. What is
 * tested is what decides whether it can: which classes are on what, that the
 * figures are final from the first render (no JS timing to wait out or to
 * misread under reduced motion), that a re-render keeps every node, and that
 * the stylesheet's own pieces are transform/opacity only and under the floor.
 */

const SUMMARY: SessionSummary = { setCount: 12, tonnageKg: 6420, exerciseCount: 3, warmupCount: 5 };
const NAMES: Record<string, string> = { squat: "Squat", bench: "Bench Press", deadlift: "Deadlift" };
const nameFor = (id: string) => NAMES[id] ?? null;

const pr = (
  exerciseId: string,
  kind: SessionPr["kind"],
  loadKg: number,
  reps: number,
  rpe: number | null = null,
  e1rmKg: number | null = null,
): SessionPr => ({ exerciseId, kind, clientSetId: `${exerciseId}-${kind}-${loadKg}`, loadKg, reps, rpe, e1rmKg });

const ONE = [pr("squat", "weight", 182.5, 1, 9)];
const MANY = [
  pr("squat", "e1rm", 175, 3, 8, 193.4),
  pr("squat", "weight", 182.5, 1, 9),
  pr("bench", "reps", 100, 8),
  pr("deadlift", "weight", 230, 1),
  pr("deadlift", "reps", 200, 5),
  pr("deadlift", "reps", 180, 8),
  pr("deadlift", "reps", 160, 12),
];

function show(prs: readonly SessionPr[], onDone = vi.fn()) {
  const user = userEvent.setup();
  const view = render(
    <FinishedSummary summary={SUMMARY} prs={prs} nameFor={nameFor} unit="kg" onDone={onDone} />,
  );
  return { user, onDone, ...view };
}

const withVibrate = () => {
  const vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
  return vibrate;
};
afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).vibrate;
});
const successes = (vibrate: ReturnType<typeof withVibrate>) =>
  vibrate.mock.calls.filter((call) => JSON.stringify((call as unknown[])[0]) === JSON.stringify(HAPTICS.success));

/** Every element in `root` whose class list animates something. */
const animated = (root: HTMLElement) =>
  [root, ...root.querySelectorAll<HTMLElement>("*")].filter((el) => /animate-|pr-card-in/.test(el.className));

describe("with no records", () => {
  it("is the screen it always was: totals at display size, no records region, no buzz", () => {
    const vibrate = withVibrate();
    const { container } = show([]);
    expect(screen.getByRole("heading", { level: 1, name: "Session done" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Personal records" })).not.toBeInTheDocument();
    const sets = screen.getByText("Sets").nextElementSibling as HTMLElement;
    expect(sets).toHaveTextContent("12");
    expect(sets.className).toBe("m-0 text-display font-semibold tabular-nums");
    expect(sets.parentElement!.className).toBe("flex flex-col gap-1 rounded-card border border-border bg-surface p-4");
    expect(animated(container)).toEqual([]);
    expect(successes(vibrate)).toHaveLength(0);
  });
});

describe("with one record", () => {
  it("leads with it, above the totals, which step back", () => {
    show(ONE);
    const records = screen.getByRole("region", { name: "Personal records" });
    const totals = screen.getByText("Sets").closest("dl")!;
    // Records before totals in the document, so read first and seen first.
    expect(records.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((screen.getByText("Sets").nextElementSibling as HTMLElement).className).toContain("text-value-sm");
    expect(within(records).getByRole("heading", { level: 2 })).toHaveTextContent("New PR");
    const [item] = within(records).getAllByRole("listitem");
    expect(item).toHaveTextContent("Squat");
    expect(item).toHaveTextContent("182.5 kg");
    expect(item).toHaveTextContent("Heaviest weight · 182.5 kg × 1 @ 9");
  });

  it("puts the count first inside the region, and the headline figure in the record colour", () => {
    show(ONE);
    const records = screen.getByRole("region", { name: "Personal records" });
    // The sweep is aria-hidden; the first thing a screen reader meets is the count.
    const firstRead = [...records.children].find((el) => el.getAttribute("aria-hidden") === null);
    expect(firstRead?.tagName).toBe("H2");
    const headline = records.querySelector<HTMLElement>("[data-pr-headline]")!;
    expect(headline).toHaveTextContent("182.5 kg");
    expect(headline.className).toContain("text-pr");
    expect(headline.className).toContain("text-hero");
    expect(records.className).toContain("bg-pr/10");
  });
});

describe("with several records", () => {
  it("counts them, keeps sessionPrs' order, and staggers each card, capped", () => {
    show(MANY);
    const records = screen.getByRole("region", { name: "Personal records" });
    expect(within(records).getByRole("heading", { level: 2 })).toHaveTextContent("7 new PRs");
    const items = within(records).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveTextContent("Estimated 1RM · 175 kg × 3 @ 8");
    expect(items[0]).toHaveTextContent("193.4 kg");
    expect(items[2]).toHaveTextContent("Bench Press");
    expect(items[2]).toHaveTextContent("8 reps");
    expect(items.map((li) => li.style.getPropertyValue("--pr-index"))).toEqual(["0", "1", "2", "3", "4", "5", "5"]);
    for (const li of items) expect(li.className).toContain("motion-safe:pr-card-in");
    // Only the first is the headline.
    expect(records.querySelectorAll("[data-pr-headline]")).toHaveLength(1);
  });
});

describe("motion", () => {
  it("gates every animation behind motion-safe, so reduced motion has nothing to play", () => {
    const { container } = show(MANY);
    const moving = animated(container);
    expect(moving.length).toBeGreaterThan(0);
    for (const el of moving) {
      const classes = el.className.split(/\s+/).filter((c) => /animate-|pr-card-in/.test(c));
      for (const c of classes) expect(c).toMatch(/^motion-safe:/);
    }
  });

  it("has every figure final on the first render, with nothing left over when the sweep does not run", () => {
    // Under reduced motion the motion-safe classes are absent: what is left is
    // the first render. The figures are already their final text (no count-up
    // to sit through or to be read mid-way), and the sweep rests invisible.
    show(ONE);
    expect(screen.getByText("182.5 kg", { selector: "[data-pr-headline]" })).toBeInTheDocument();
    const sweep = document.querySelector<HTMLElement>("[data-pr-sweep]")!;
    expect(sweep).toHaveAttribute("aria-hidden");
    expect(sweep.className).toContain("opacity-0");
  });

  it("never delays Back to Today", async () => {
    const { user, onDone } = show(MANY);
    const done = screen.getByRole("button", { name: "Back to Today" });
    expect(done.closest('[class*="animate-"], [class*="pr-card-in"]')).toBeNull();
    await user.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps every node through a re-render, so nothing plays twice", () => {
    const { rerender } = show(MANY);
    const before = [...screen.getAllByRole("listitem"), document.querySelector("[data-pr-sweep]")];
    rerender(
      <FinishedSummary
        summary={{ ...SUMMARY }}
        prs={[...MANY]}
        nameFor={(id) => nameFor(id)}
        unit="kg"
        onDone={vi.fn()}
      />,
    );
    const after = [...screen.getAllByRole("listitem"), document.querySelector("[data-pr-sweep]")];
    after.forEach((node, i) => expect(node).toBe(before[i]));
  });
});

describe("the haptic", () => {
  it("buzzes success once when the screen arrives with a record, and not on a re-render", () => {
    const vibrate = withVibrate();
    const { rerender } = render(
      <StrictMode>
        <FinishedSummary summary={SUMMARY} prs={MANY} nameFor={nameFor} unit="kg" onDone={vi.fn()} />
      </StrictMode>,
    );
    expect(successes(vibrate)).toHaveLength(1);
    rerender(
      <StrictMode>
        <FinishedSummary summary={SUMMARY} prs={[...ONE]} nameFor={nameFor} unit="kg" onDone={vi.fn()} />
      </StrictMode>,
    );
    expect(successes(vibrate)).toHaveLength(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("stays silent where there is no vibrate (iPhone), and the screen is unchanged", () => {
    show(ONE);
    expect(screen.getByRole("region", { name: "Personal records" })).toBeInTheDocument();
  });
});

describe("the stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("moves pr-sweep by translate and opacity only", () => {
    const body = /@keyframes pr-sweep\s*\{([\s\S]*?)\n  \}/.exec(css)?.[1];
    expect(body).toBeDefined();
    const props = [...body!.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) expect(["translate", "opacity"]).toContain(p);
    // It ends invisible, so the 0.01ms reduced-motion run leaves nothing on screen.
    expect(/to\s*\{\s*opacity:\s*0;/.test(body!)).toBe(true);
  });

  it("plays pr-card-in as row-in, which is translate and opacity", () => {
    expect(css).toMatch(/@utility pr-card-in\s*\{\s*animation:\s*var\(--animate-row-in\);/);
    const rowIn = /@keyframes row-in\s*\{([\s\S]*?)\n  \}/.exec(css)?.[1] ?? "";
    for (const m of rowIn.matchAll(/^\s*([a-z-]+):/gm)) expect(["translate", "opacity"]).toContain(m[1]);
  });

  it("has the reduced-motion floor over the athlete shell, delays included", () => {
    const floor = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(floor).toContain(".athlete-motion *");
    expect(floor).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(floor).toMatch(/animation-delay:\s*0s !important/);
    expect(floor).toMatch(/animation-iteration-count:\s*1 !important/);
  });
});
