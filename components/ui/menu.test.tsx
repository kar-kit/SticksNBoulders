import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Menu } from "./menu";

const setup = () => {
  const duplicate = vi.fn();
  const remove = vi.fn();
  render(
    <div>
      <button type="button">Elsewhere</button>
      <Menu
        label="Week 2 actions"
        items={[
          { label: "Duplicate week 2", onSelect: duplicate },
          false,
          { label: "Locked", onSelect: vi.fn(), disabled: true },
          { label: "Remove week 2", onSelect: remove, tone: "danger" },
        ]}
      />
    </div>,
  );
  return { duplicate, remove, trigger: screen.getByRole("button", { name: "Week 2 actions" }) };
};

describe("the ⋯ menu", () => {
  it("is closed until asked, and says it has a menu", () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens on a click with the first item focused, skipping falsy entries", async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Duplicate week 2",
      "Locked",
      "Remove week 2",
    ]);
    expect(screen.getByRole("menuitem", { name: "Duplicate week 2" })).toHaveFocus();
  });

  it("walks the items with the arrows, wrapping and skipping a disabled one, and Home/End", async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    trigger.focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Remove week 2" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Duplicate week 2" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Remove week 2" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Duplicate week 2" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Remove week 2" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Duplicate week 2" })).toHaveFocus();
  });

  it("runs the chosen item from the keyboard, once, and closes with the focus back on the trigger", async () => {
    const user = userEvent.setup();
    const { trigger, duplicate, remove } = setup();
    trigger.focus();
    await user.keyboard("{ArrowDown}{End}{Enter}");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(duplicate).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape, giving the focus back, without running anything", async () => {
    const user = userEvent.setup();
    const { trigger, duplicate, remove } = setup();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(duplicate).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("closes on a click anywhere else, and on a second click of the trigger", async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders nothing when it has nothing to offer", () => {
    render(<Menu label="Empty actions" items={[false, null]} />);
    expect(screen.queryByRole("button", { name: "Empty actions" })).not.toBeInTheDocument();
  });
});
