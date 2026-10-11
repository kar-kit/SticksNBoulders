import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { recallUnits, rememberUnits, UnitsProvider, useUnits } from "./units-context";
import type { Profile } from "./profile";

const read = vi.hoisted(() => ({ profile: null as Profile | null, calls: 0, gate: null as Promise<void> | null }));
vi.mock("./profile-store", () => ({
  fetchProfile: async () => {
    read.calls += 1;
    if (read.gate) await read.gate;
    return read.profile;
  },
}));

const profile = (units: "kg" | "lb"): Profile => ({
  userId: "joey",
  displayName: "Joey",
  sex: null,
  units,
  avatarFileId: null,
});

function Probe() {
  const { unit, setUnit } = useUnits();
  return (
    <>
      <output aria-label="unit">{unit}</output>
      <button type="button" onClick={() => setUnit("lb")}>
        Pounds
      </button>
    </>
  );
}

const shown = () => screen.getByLabelText("unit");

beforeEach(() => {
  localStorage.clear();
  read.profile = null;
  read.calls = 0;
  read.gate = null;
});

describe("the athlete's weight unit", () => {
  it("is kilos outside the provider, which is every coach screen", () => {
    render(<Probe />);
    expect(shown()).toHaveTextContent("kg");
  });

  it("takes the unit from the profile", async () => {
    read.profile = profile("lb");
    render(
      <UnitsProvider userId="joey">
        <Probe />
      </UnitsProvider>,
    );
    await waitFor(() => expect(shown()).toHaveTextContent("lb"));
    // And keeps it on the device for the next cold start.
    expect(recallUnits("joey")).toBe("lb");
  });

  it("keeps the last unit this device saw when the profile cannot be read", async () => {
    // No signal on a reload: a set typed now must still be read as pounds.
    rememberUnits("joey", "lb");
    render(
      <UnitsProvider userId="joey">
        <Probe />
      </UnitsProvider>,
    );
    await waitFor(() => expect(shown()).toHaveTextContent("lb"));
    await waitFor(() => expect(read.calls).toBe(1));
    expect(shown()).toHaveTextContent("lb");
  });

  it("never applies one account's cached unit to another", async () => {
    rememberUnits("someone-else", "lb");
    render(
      <UnitsProvider userId="joey">
        <Probe />
      </UnitsProvider>,
    );
    await waitFor(() => expect(read.calls).toBe(1));
    expect(shown()).toHaveTextContent("kg");
  });

  it("moves at once when the athlete picks a unit, and a slower read does not undo it", async () => {
    // The profile read is still on the wire, holding the old answer.
    read.profile = profile("kg");
    let release: () => void = () => {};
    read.gate = new Promise<void>((resolve) => (release = resolve));
    render(
      <UnitsProvider userId="joey">
        <Probe />
      </UnitsProvider>,
    );
    await waitFor(() => expect(read.calls).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "Pounds" }));
    expect(shown()).toHaveTextContent("lb");

    await act(async () => {
      release();
      await read.gate;
    });
    expect(shown()).toHaveTextContent("lb");
    expect(recallUnits("joey")).toBe("lb");
  });
});
