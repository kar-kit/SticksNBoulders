import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExerciseTypeahead } from "./exercise-typeahead";
import { normaliseExerciseName } from "@/appwrite/documents";
import type { Exercise } from "@/lib/exercises/match";

const make = (name: string, options: Partial<Exercise> = {}): Exercise => ({
  id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  normalisedName: normaliseExerciseName(name),
  isGlobal: true,
  ...options,
});

const LIBRARY = [
  make("Squat"),
  make("Front Squat"),
  make("Bench Press"),
  make("Romanian Deadlift"),
  make("Joey's Machine Thing", { isGlobal: false, ownerId: "joey" }),
];

const options = () => screen.queryAllByRole("option").map((el) => el.textContent);

function setup(props: Partial<React.ComponentProps<typeof ExerciseTypeahead>> = {}) {
  const onSelect = vi.fn();
  const onCreate = vi.fn();
  render(
    <ExerciseTypeahead exercises={LIBRARY} onSelect={onSelect} onCreate={onCreate} {...props} />,
  );
  return { onSelect, onCreate, user: userEvent.setup(), input: screen.getByRole("combobox") };
}

describe("typing an exercise", () => {
  it("ranks the library as you type", async () => {
    const { user, input } = setup();
    await user.type(input, "squ");
    expect(options()?.[0]).toContain("Squat");
  });

  it("answers an abbreviation, because that is how a coach writes it", async () => {
    const { user, input } = setup();
    await user.type(input, "rdl");
    expect(options()?.[0]).toContain("Romanian Deadlift");
  });

  it("offers something the moment the field is focused", async () => {
    // An empty list on an empty field reads as a broken screen, and Ruairi's
    // first session is an entirely empty account.
    const { user, input } = setup();
    await user.click(input);
    expect(options().length).toBeGreaterThan(0);
  });

  it("marks an exercise the athlete typed in themselves", async () => {
    const { user, input } = setup();
    await user.click(input);
    expect(options()?.[0]).toContain("yours");
  });

  it("selects on tap and fills the field with the chosen name", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "bench");
    await user.click(screen.getByRole("option", { name: /Bench Press/ }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "Bench Press" }));
    expect(input).toHaveValue("Bench Press");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("a field whose job is adding another", () => {
  it("empties itself after a choice when asked to", async () => {
    // Otherwise the athlete has to clear the last lift's name by hand before
    // typing the next one, one-handed, mid-session.
    const { user } = setup({ clearOnSelect: true });
    const input = screen.getByRole("combobox");
    await user.type(input, "bench");
    await user.click(screen.getByRole("option", { name: "Bench Press" }));
    expect(input).toHaveValue("");
  });

  it("keeps the name by default, for a picker that holds a value", async () => {
    const { user, input } = setup();
    await user.type(input, "bench");
    await user.click(screen.getByRole("option", { name: "Bench Press" }));
    expect(input).toHaveValue("Bench Press");
  });
});

describe("creating one that does not exist", () => {
  it("offers to add a name the library does not hold", async () => {
    const { user, input } = setup();
    await user.type(input, "Zercher Squat");
    expect(options().at(-1)).toContain("Zercher Squat");
    expect(options().at(-1)).toContain("new");
  });

  it("offers creation as an action, not as a command built from half a word", async () => {
    const { user, input } = setup();
    await user.type(input, "bench");

    const create = screen.getByRole("option", { name: /Add custom exercise/ });
    expect(create).toHaveTextContent("Add custom exercise");
    expect(screen.queryByText("Add bench")).not.toBeInTheDocument();
  });

  it("still shows the name it would create, so nothing lands in the library unseen", async () => {
    // This row is one tap from a permanent entry in the athlete's library.
    const { user, input } = setup();
    await user.type(input, "bench");
    expect(screen.getByRole("option", { name: /Add custom exercise/ })).toHaveTextContent("bench");
  });

  it("creates exactly what was typed, not the generic label", async () => {
    const { user, input, onCreate } = setup();
    await user.type(input, "bench");
    await user.click(screen.getByRole("option", { name: /Add custom exercise/ }));
    expect(onCreate).toHaveBeenCalledWith("bench");
  });

  it("offers it last, never under the thumb", async () => {
    // Choosing an existing lift is the common case, and an accidental create
    // splits that lift's history across two ids.
    const { user, input } = setup();
    await user.type(input, "squat");
    expect(options()[0]).not.toContain("new");
  });

  it("never offers to create an abbreviation as an exercise", async () => {
    // "rdl" is how Romanian Deadlift gets typed, not a lift anyone wants in
    // their library under that name.
    const { user, input } = setup();
    await user.type(input, "rdl");
    expect(options()).toHaveLength(1);
    expect(options()[0]).toContain("Romanian Deadlift");
  });

  it("suppresses creation even when the acronym match falls outside the shown list", async () => {
    // The suppression rule must not depend on the display cap, or it quietly
    // stops working as the library grows.
    const { user, input } = setup({ limit: 1 });
    await user.type(input, "rdl");
    expect(options().some((text) => text?.includes("new"))).toBe(false);
  });

  it("still offers to create something that merely resembles an existing lift", async () => {
    // Being unable to add a lift is the failure that sends a coach back to a
    // spreadsheet, so a loose resemblance does not block creation.
    const { user, input } = setup();
    await user.type(input, "Belt Squat");
    expect(options().at(-1)).toContain("Belt Squat");
    expect(options().at(-1)).toContain("new");
  });

  it("does not offer to create a name that only differs by case or spacing", async () => {
    const { user, input } = setup();
    await user.type(input, "  BENCH   press ");
    expect(options().some((text) => text?.includes("new"))).toBe(false);
  });

  it("reports the typed name when chosen", async () => {
    const { user, input, onCreate } = setup();
    await user.type(input, "Zercher Squat");
    await user.click(screen.getByRole("option", { name: /Zercher Squat/ }));
    expect(onCreate).toHaveBeenCalledWith("Zercher Squat");
  });

  it("never offers creation where the caller forbids it", async () => {
    const { user, input } = setup({ onCreate: undefined });
    await user.type(input, "Zercher Squat");
    expect(options()).toEqual([]);
  });
});

describe("the keyboard, for the coach at 1440", () => {
  it("moves with the arrows and selects with Enter", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "squat");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "Front Squat" }));
  });

  it("wraps, so holding one arrow key reaches everything", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "squat");
    // Two results; three downs from the first lands back on the first.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "Squat" }));
  });

  it("dismisses on Escape and keeps what was typed, choosing nothing", async () => {
    const { user, input, onSelect, onCreate } = setup();
    await user.type(input, "squat");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("squat");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("does nothing on Enter when nothing matched", async () => {
    const { user, input, onSelect, onCreate } = setup({ onCreate: undefined });
    await user.type(input, "kettlebell juggling");
    await user.keyboard("{Enter}");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("assistive technology", () => {
  it("is a combobox that reports whether its list is open", async () => {
    const { user, input } = setup();
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.type(input, "squat");
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("names the active option, and moves that name with the arrows", async () => {
    const { user, input } = setup();
    await user.type(input, "squat");
    const first = input.getAttribute("aria-activedescendant");
    expect(screen.getByRole("option", { name: /^Squat$/ })).toHaveAttribute("id", first!);

    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).not.toBe(first);
  });

  it("does not autocorrect or capitalise the field into something else", async () => {
    const { input } = setup();
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });
});

describe("a library longer than the list", () => {
  const BIG = Array.from({ length: 30 }, (_, i) => make(`Lift ${String(i).padStart(2, "0")}`));

  it("scrolls inside a capped box rather than clipping what does not fit", async () => {
    const { user, input } = setup({ exercises: BIG });
    await user.click(input);
    const list = screen.getByRole("listbox");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("max-h-");
    expect(list.className).not.toContain("overflow-hidden");
  });

  it("offers the whole library on an empty field when the caller lifts the cap", async () => {
    const { user, input } = setup({ exercises: BIG, limit: BIG.length });
    await user.click(input);
    expect(options()).toHaveLength(30);
    expect(options().at(-1)).toContain("Lift 29");
  });

  it("keeps the cap by default, so the athlete's phone still opens on a short list", async () => {
    const { user, input } = setup({ exercises: BIG });
    await user.click(input);
    expect(options().length).toBeLessThan(30);
  });

  it("follows the keyboard: the active option is scrolled into view", async () => {
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    try {
      const { user, input } = setup({ exercises: BIG, limit: BIG.length });
      await user.click(input);
      scrolled.mockClear();
      await user.keyboard("{ArrowUp}");
      // Wraps from the first option to the last, which is far below the fold.
      const last = screen.getAllByRole("option").at(-1)!;
      expect(last).toHaveAttribute("aria-selected", "true");
      expect(scrolled.mock.contexts.at(-1)).toBe(last);
      expect(scrolled).toHaveBeenLastCalledWith({ block: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe("cardio (F23)", () => {
  const withBike = [...LIBRARY, make("Bike", { kind: "cardio" }), make("Ski Erg", { kind: "cardio", isGlobal: false, ownerId: "joey" })];

  it("tags a cardio exercise in the list, and says so to a screen reader", async () => {
    const { user, input } = setup({ exercises: withBike });
    await user.type(input, "bike");
    expect(screen.getByRole("option", { name: "Bike, cardio" })).toHaveTextContent("cardio");
    await user.clear(input);
    await user.type(input, "ski");
    expect(screen.getByRole("option", { name: "Ski Erg, cardio" })).toHaveTextContent("cardio · yours");
  });

  it("offers Add as cardio under the plain create, only where the screen asks for it", async () => {
    const onCreateCardio = vi.fn();
    const { user, input, onCreate } = setup({ onCreateCardio });
    await user.type(input, "Assault Bike");
    const names = screen.getAllByRole("option").map((el) => el.getAttribute("aria-label"));
    expect(names.slice(-2)).toEqual(["Add custom exercise: Assault Bike", "Add custom cardio exercise: Assault Bike"]);
    await user.click(screen.getByRole("option", { name: "Add custom cardio exercise: Assault Bike" }));
    expect(onCreateCardio).toHaveBeenCalledWith("Assault Bike");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("offers no cardio create without the handler, as in the Program Editor", async () => {
    const { user, input } = setup();
    await user.type(input, "Assault Bike");
    expect(screen.queryByRole("option", { name: /cardio/ })).not.toBeInTheDocument();
  });
});
