import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, type ButtonVariant } from "./button";
import { TextField } from "./input";
import { ExerciseTypeahead } from "@/components/exercises/exercise-typeahead";

/**
 * The athlete's phone screens must not move because the coach's do
 * (docs/coach-motion.md). These shared components carry the coach's motion
 * only behind the `coach:` variant, which matches inside the coach shell and
 * nowhere else -- so every motion class they render has to be one of those.
 * A bare `animate-*`, `transition-control`, `press` or `rule-*` here would
 * animate the logger.
 */
const MOTION = /^(animate-|motion-safe:|motion-reduce:|transition-control$|press$|press-wide$|rule-|aria-[a-z[\]=]+:rule-on$|duration-|ease-)/;

function bareMotion(root: HTMLElement): string[] {
  const found = new Set<string>();
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    for (const token of el.getAttribute("class")?.split(/\s+/) ?? []) {
      if (MOTION.test(token)) found.add(token);
    }
  }
  return [...found];
}

describe("shared components stay still outside the coach shell", () => {
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
