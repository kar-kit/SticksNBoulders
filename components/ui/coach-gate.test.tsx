import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, type ButtonVariant } from "./button";
import { TextField } from "./input";
import { ExerciseTypeahead } from "@/components/exercises/exercise-typeahead";

/**
 * Shared components must not move because one side's do
 * (docs/coach-motion.md, docs/athlete-motion.md). They carry motion only
 * behind the `coach:` or `athlete:` variant, each of which matches inside its
 * own shell and nowhere else -- so every motion class they render has to be
 * one of those. A bare `animate-*`, `transition-control`, `press`, `tap` or
 * `rule-*` here would animate the logger with the coach's motion, or the
 * coach's grid and the sign-in screen with the athlete's.
 */
const MOTION = /^(animate-|motion-safe:|motion-reduce:|transition-control$|press$|press-wide$|tap$|rule-|aria-[a-z[\]=]+:rule-on$|duration-|ease-)/;

function bareMotion(root: HTMLElement): string[] {
  const found = new Set<string>();
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    for (const token of el.getAttribute("class")?.split(/\s+/) ?? []) {
      if (MOTION.test(token)) found.add(token);
    }
  }
  return [...found];
}

describe("shared components stay still outside their shell", () => {
  it("Button, every variant", () => {
    const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
    const { container } = render(
      <>
        {variants.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
      </>,
    );
    expect(bareMotion(container)).toEqual([]);
    // And the coach's motion is there, behind the gate.
    expect(screen.getByRole("button", { name: "primary" }).className).toContain("coach:transition-control");
    // And the athlete's press, behind its own.
    for (const variant of variants) {
      expect(screen.getByRole("button", { name: variant }).className).toContain("athlete:tap");
    }
  });

  it("TextField", () => {
    const { container } = render(<TextField aria-label="Weight" />);
    expect(bareMotion(container)).toEqual([]);
  });

  it("the exercise typeahead, with its list open and an option active", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ExerciseTypeahead
        exercises={[
          { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true },
          { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true },
        ]}
        onSelect={() => {}}
        onCreate={() => {}}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(bareMotion(container)).toEqual([]);
    expect(screen.getByRole("listbox").className).toContain("coach:motion-safe:animate-pop-in");
  });
});
