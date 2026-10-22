import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VariantSheet } from "./variant-sheet";

const haptic = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/ui/haptics", () => ({ haptic }));

const options = [
  { id: "cable", name: "Cable Front Raise" },
  { id: "db", name: "Dumbbell Front Raise" },
  { id: "plate", name: "Plate Front Raise" },
];

describe("VariantSheet", () => {
  it("lists the options in the order given, the coach's pick labelled", () => {
    render(<VariantSheet name="Cable Front Raise" options={options} currentId="cable" coachId="cable" onPick={vi.fn()} onCancel={vi.fn()} />);
    const sheet = screen.getByRole("region", { name: "Swap variant of Cable Front Raise" });
    const buttons = within(sheet).getAllByRole("button").slice(0, 3);
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Cable Front RaiseCoach’s pick",
      "Dumbbell Front Raise",
      "Plate Front Raise",
    ]);
  });

  it("marks the variant in hand as pressed", () => {
    render(<VariantSheet name="Dumbbell Front Raise" options={options} currentId="db" coachId="cable" onPick={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Dumbbell Front Raise" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Cable Front Raise/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("labels no coach's pick on a free block", () => {
    render(<VariantSheet name="Cable Front Raise" options={options} currentId="cable" coachId={null} onPick={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText("Coach’s pick")).not.toBeInTheDocument();
  });

  it("picks with one tap and a light buzz", async () => {
    const onPick = vi.fn();
    render(<VariantSheet name="Cable Front Raise" options={options} currentId="cable" coachId="cable" onPick={onPick} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Plate Front Raise" }));
    expect(onPick).toHaveBeenCalledWith("plate");
    expect(haptic).toHaveBeenCalledWith("light");
  });

  it("cancels", async () => {
    const onCancel = vi.fn();
    render(<VariantSheet name="Cable Front Raise" options={options} currentId="cable" coachId="cable" onPick={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
