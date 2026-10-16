import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BodyweightScreen } from "./bodyweight-screen";
import { dayKey, type BodyweightEntry } from "@/lib/bodyweight/bodyweight";

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "joey", name: "Joey", email: "j@e.com" } },
    refresh: vi.fn(),
  }),
}));

const units = vi.hoisted(() => ({ unit: "kg" as "kg" | "lb" }));
vi.mock("@/lib/profile/units-context", () => ({
  useUnits: () => ({ unit: units.unit, setUnit: vi.fn() }),
}));

// DOTS reads its own data and has its own tests; this screen only places it.
vi.mock("@/components/strength/dots-block", () => ({ DotsBlock: () => null }));

const store = vi.hoisted(() => ({
  entries: [] as BodyweightEntry[],
  logBodyweight: vi.fn(),
}));
// The real check behind a fake write, so a rejection reads as it would.
vi.mock("@/lib/bodyweight/store", async () => {
  const { checkWeight } = await import("@/lib/bodyweight/bodyweight");
  store.logBodyweight.mockImplementation(async (_athleteId: string, weight: number, _on: string, unit?: "kg" | "lb") => {
    const checked = checkWeight(weight, unit);
    return checked.ok ? { ok: true, entry: { weightKg: checked.weightKg } } : checked;
  });
  return { fetchBodyweight: async () => store.entries, logBodyweight: store.logBodyweight };
});

const entry = (weightKg: number): BodyweightEntry => ({
  id: "e1",
  athleteId: "joey",
  weightKg,
  measuredOn: dayKey(),
  recordedAt: new Date().toISOString(),
});

beforeEach(() => {
  units.unit = "kg";
  store.entries = [];
  store.logBodyweight.mockClear();
});

describe("Bodyweight for an athlete who reads pounds", () => {
  beforeEach(() => {
    units.unit = "lb";
  });

  it("shows the stored kilos in pounds", async () => {
    store.entries = [entry(81.647)];
    render(<BodyweightScreen />);
    // The headline and the recent list both, and never the kilos.
    expect(await screen.findAllByText("180.0")).toHaveLength(2);
    expect(screen.getByText("lb")).toBeInTheDocument();
    expect(screen.queryByText("81.6")).not.toBeInTheDocument();
  });

  it("logs a weight typed in pounds as pounds, so 180 is not stored as 180 kg", async () => {
    const user = userEvent.setup();
    render(<BodyweightScreen />);
    await user.type(await screen.findByLabelText("Log today's weight"), "180");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(store.logBodyweight).toHaveBeenCalledTimes(1));
    expect(store.logBodyweight).toHaveBeenCalledWith("joey", 180, dayKey(), "lb");
  });

  it("explains an out-of-range weight in pounds", async () => {
    const user = userEvent.setup();
    render(<BodyweightScreen />);
    await user.type(await screen.findByLabelText("Log today's weight"), "18");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/between 44.1 and 881.8 lb/)).toBeInTheDocument();
  });
});
