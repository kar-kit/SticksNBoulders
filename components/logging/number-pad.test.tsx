import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberPad, type NumberPadProps } from "./number-pad";
import { beginEdit } from "@/lib/logging/number-pad";
import { HAPTICS } from "@/lib/ui/haptics";

function setup(overrides: Partial<NumberPadProps> = {}) {
  const props: NumberPadProps = {
    state: beginEdit("load", 140, "kg"),
    onChange: vi.fn(),
    onNext: vi.fn(),
    nextLabel: "Reps",
    isWarmup: false,
    onToggleWarmup: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<NumberPad {...props} />);
  return props;
}

describe("NumberPad", () => {
  let vibrate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
  });
  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate;
  });

  it("types a digit into the value and answers with the lightest tick", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "5" }));
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([...HAPTICS.light]);
  });

  it("ticks on the steppers too, but not on Next or Done", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Increase weight by 2.5 kg" }));
    expect(vibrate).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Reps" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onNext).toHaveBeenCalled();
    expect(props.onDismiss).toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("still types where the phone has no vibration (iOS)", async () => {
    delete (navigator as { vibrate?: unknown }).vibrate;
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "7" }));
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it("flips the warm-up switch", async () => {
    const props = setup({ isWarmup: false });
    const toggle = screen.getByRole("switch", { name: "Warm-up" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(props.onToggleWarmup).toHaveBeenCalledWith(true);
  });

  it("draws its own top edge in flow, as History shows it", () => {
    setup();
    expect(screen.getByRole("region", { name: "Weight, kg keypad" }).className).toContain("border-t");
  });

  it("leaves the edge and fill to the sheet it sits in", () => {
    setup({ inSheet: true });
    const pad = screen.getByRole("region", { name: "Weight, kg keypad" });
    expect(pad.className).not.toContain("border-t");
    expect(pad.className).not.toContain("bg-surface");
  });
});

describe("NumberPad without onDismiss", () => {
  it("has no Done, for a sheet with its own Cancel and Save", () => {
    render(
      <NumberPad
        state={beginEdit("load", 140, "kg")}
        onChange={vi.fn()}
        onNext={vi.fn()}
        nextLabel="Reps"
        isWarmup={false}
        onToggleWarmup={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reps" })).toBeInTheDocument();
  });
});
