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
