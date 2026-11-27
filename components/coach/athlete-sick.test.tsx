import { render, screen, waitFor, within } from "@testing-library/react";
import { AthleteSick } from "./athlete-sick";
import type { SickSpell } from "@/lib/sick/sick";

const store = vi.hoisted(() => ({ fetchSickDays: vi.fn<(ids: readonly string[], since: string) => Promise<SickSpell[]>>() }));
vi.mock("@/lib/sick/sick-store", () => store);

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const spell = (startsOn: string, endsOn: string, note: string | null = null, id = "sk-1"): SickSpell => ({
  id,
  athleteId: "joey",
  startsOn,
  endsOn,
  note,
  createdAt: "2026-11-27T08:00:00.000Z",
});

beforeEach(() => {
  store.fetchSickDays.mockReset();
});

describe("the Athlete View's call-in sick (F31)", () => {
  it("shows an athlete who is off sick, with the dates and the note they left", async () => {
    store.fetchSickDays.mockResolvedValue([spell(day(-1), day(2), "Flu, back Friday")]);
    render(<AthleteSick athleteId="joey" />);
    const banner = await screen.findByRole("region", { name: "Sick" });
    expect(within(banner).getByText("Off sick")).toBeInTheDocument();
    expect(within(banner).getByText(/\d+ \w{3} to \d+ \w{3}/)).toBeInTheDocument();
    expect(within(banner).getByText(/Flu, back Friday/)).toBeInTheDocument();
  });

  it("shows one still to come as such, not as sick now", async () => {
    store.fetchSickDays.mockResolvedValue([spell(day(3), day(4))]);
    render(<AthleteSick athleteId="joey" />);
    expect(await screen.findByText("Sick from")).toBeInTheDocument();
    expect(screen.queryByText("Off sick")).not.toBeInTheDocument();
  });

  it("shows nothing at all for an athlete who is not sick: no banner that says so", async () => {
    store.fetchSickDays.mockResolvedValue([spell(day(-5), day(-2))]);
    const { container } = render(<AthleteSick athleteId="joey" />);
    await waitFor(() => expect(store.fetchSickDays).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the read fails, as the panels beside it do", async () => {
    store.fetchSickDays.mockRejectedValue(new Error("refused"));
    const { container } = render(<AthleteSick athleteId="joey" />);
    await waitFor(() => expect(store.fetchSickDays).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("asks for this athlete only, from today", async () => {
    store.fetchSickDays.mockResolvedValue([]);
    render(<AthleteSick athleteId="joey" />);
    await waitFor(() => expect(store.fetchSickDays).toHaveBeenCalledWith(["joey"], day(0)));
  });

  it("does not carry one athlete's banner over to the next", async () => {
    store.fetchSickDays.mockResolvedValueOnce([spell(day(0), day(1), "Flu")]).mockResolvedValueOnce([]);
    const { rerender, container } = render(<AthleteSick athleteId="joey" />);
    await screen.findByRole("region", { name: "Sick" });
    rerender(<AthleteSick athleteId="sam" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
