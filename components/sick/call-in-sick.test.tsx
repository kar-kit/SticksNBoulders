import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CallInSick } from "./call-in-sick";
import type { SickSpell } from "@/lib/sick/sick";

/**
 * Today's call-in sick (F31), against a hook that answers what each test
 * says it does. The hook's own behaviour -- cache, queue, optimistic state --
 * is lib/sick/use-my-sick.test.tsx.
 */

const mine = vi.hoisted(() => ({
  value: { spells: [] as unknown[], known: true, pending: false, callIn: vi.fn(), end: vi.fn() },
}));
vi.mock("@/lib/sick/use-my-sick", () => ({ useMySick: () => mine.value }));

// jsdom has no showModal or close; the sheet falls back to the open attribute.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Friday 27 November, noon, local.
  vi.setSystemTime(new Date("2026-11-27T12:00:00"));
  mine.value = { spells: [], known: true, pending: false, callIn: vi.fn(async () => {}), end: vi.fn(async () => {}) };
});
afterEach(() => vi.useRealTimers());

const spell = (over: Partial<SickSpell> = {}): SickSpell => ({
  id: "sk-1",
  athleteId: "joey",
  startsOn: "2026-11-27",
  endsOn: "2026-11-29",
  note: null,
  createdAt: "2026-11-27T08:00:00.000Z",
  ...over,
});

const setup = (hasCoach: boolean | null = true) => {
  render(<CallInSick athleteId="joey" hasCoach={hasCoach} />);
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
};

describe("the entry row", () => {
  it("is a 44px row an athlete with a coach can reach, and says who it tells", () => {
    setup();
    const row = screen.getByRole("button", { name: /Call in sick/ });
    expect(row).toHaveClass("min-h-[44px]");
    expect(within(row).getByText("Tell your coach")).toBeInTheDocument();
  });

  it("is absent, not greyed out, with no coach", () => {
    setup(false);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("waits while it is not yet known whether there is a coach", () => {
    setup(null);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("still shows a call-in already made after the coach has gone, so it can be ended", () => {
    mine.value.spells = [spell()];
    setup(false);
    expect(screen.getByRole("region", { name: "Off sick" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I’m better" })).toBeInTheDocument();
  });
});

/** Opens the sheet and returns it, for `within`. */
async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Call in sick|Add days/ }));
  return screen.getByRole("dialog", { name: "Call in sick" });
}

describe("the sheet", () => {
  it("opens on today, one day, with an empty note and the promise that nothing moves", async () => {
    const user = setup();
    const sheet = await openSheet(user);
    expect(within(sheet).getByLabelText("From")).toHaveValue("2026-11-27");
    expect(within(sheet).getByLabelText("Through")).toHaveValue("2026-11-27");
    expect(within(sheet).getByLabelText(/Note for your coach/)).toHaveValue("");
    expect(within(sheet).getByText(/Nothing in your program moves/)).toBeInTheDocument();
  });

  it("calls in for today with one tap, and goes away", async () => {
    const user = setup();
    const sheet = await openSheet(user);
    await user.click(within(sheet).getByRole("button", { name: "Call in sick" }));
    expect(mine.value.callIn).toHaveBeenCalledWith({ startsOn: "2026-11-27", endsOn: "2026-11-27", note: "" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends the note and a run of days", async () => {
    const user = setup();
    const sheet = await openSheet(user);
    fireEvent.change(within(sheet).getByLabelText("Through"), { target: { value: "2026-11-30" } });
    await user.type(within(sheet).getByLabelText(/Note for your coach/), "Flu, back Tuesday");
    await user.click(within(sheet).getByRole("button", { name: "Call in sick" }));
    expect(mine.value.callIn).toHaveBeenCalledWith({ startsOn: "2026-11-27", endsOn: "2026-11-30", note: "Flu, back Tuesday" });
  });

  it("moves the last day along when the first is set past it, so a range is never backwards", async () => {
    const user = setup();
    const sheet = await openSheet(user);
    fireEvent.change(within(sheet).getByLabelText("From"), { target: { value: "2026-12-02" } });
    expect(within(sheet).getByLabelText("Through")).toHaveValue("2026-12-02");
    expect(within(sheet).getByLabelText("Through")).toHaveAttribute("min", "2026-12-02");
  });

  it("can call in for a day that has passed: catching up on yesterday", async () => {
    const user = setup();
    const sheet = await openSheet(user);
    fireEvent.change(within(sheet).getByLabelText("From"), { target: { value: "2026-11-25" } });
    await user.click(within(sheet).getByRole("button", { name: "Call in sick" }));
    expect(mine.value.callIn).toHaveBeenCalledWith({ startsOn: "2026-11-25", endsOn: "2026-11-27", note: "" });
  });

  it("will not send more than a month, and says so in words", async () => {
    const user = setup();
    const sheet = await openSheet(user);
    fireEvent.change(within(sheet).getByLabelText("Through"), { target: { value: "2027-02-01" } });
    expect(within(sheet).getByRole("alert")).toHaveTextContent(/up to 31 days/);
    expect(within(sheet).getByRole("button", { name: "Call in sick" })).toBeDisabled();
  });

  it("will not send with a day cleared", async () => {
    const user = setup();
    const sheet = await openSheet(user);
    fireEvent.change(within(sheet).getByLabelText("Through"), { target: { value: "" } });
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Pick both days.");
    expect(within(sheet).getByRole("button", { name: "Call in sick" })).toBeDisabled();
  });

  it("cuts a note at the column's length at the field, so nothing is cut behind the athlete's back", async () => {
    const user = setup();
    const sheet = await openSheet(user);
    expect(within(sheet).getByLabelText(/Note for your coach/)).toHaveAttribute("maxlength", "200");
  });

  it("cancels without calling in", async () => {
    const user = setup();
    const sheet = await openSheet(user);
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(mine.value.callIn).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens afresh each time: yesterday's draft is not still there", async () => {
    const user = setup();
    let sheet = await openSheet(user);
    await user.type(within(sheet).getByLabelText(/Note for your coach/), "typed");
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    sheet = await openSheet(user);
    expect(within(sheet).getByLabelText(/Note for your coach/)).toHaveValue("");
  });
});

describe("sick today", () => {
  it("says so, until when, with the note, and what the athlete will wonder: the coach knows and nothing moved", () => {
    mine.value.spells = [spell({ note: "Flu" })];
    setup();
    const card = screen.getByRole("region", { name: "Off sick" });
    expect(within(card).getByText("Off sick until Sunday 29 Nov")).toBeInTheDocument();
    expect(within(card).getByText("Flu")).toBeInTheDocument();
    expect(within(card).getByText(/Your coach knows\. Nothing in your program has moved/)).toBeInTheDocument();
  });

  it("says today when today is the last day", () => {
    mine.value.spells = [spell({ startsOn: "2026-11-27", endsOn: "2026-11-27" })];
    setup();
    expect(screen.getByText("Off sick today")).toBeInTheDocument();
  });

  it("runs back-to-back call-ins into one stretch", () => {
    mine.value.spells = [spell({ id: "a", endsOn: "2026-11-27" }), spell({ id: "b", startsOn: "2026-11-28", endsOn: "2026-12-01", createdAt: "2026-11-27T09:00:00.000Z" })];
    setup();
    expect(screen.getByText("Off sick until Tuesday 1 Dec")).toBeInTheDocument();
  });

  it("ends it with I'm better, from today", async () => {
    mine.value.spells = [spell()];
    const user = setup();
    await user.click(screen.getByRole("button", { name: "I’m better" }));
    expect(mine.value.end).toHaveBeenCalledWith("2026-11-27");
  });

  it("offers more days from the day after it ends, and calls in again from there", async () => {
    mine.value.spells = [spell()];
    const user = setup();
    const sheet = await openSheet(user);
    expect(within(sheet).getByLabelText("From")).toHaveValue("2026-11-30");
    await user.click(within(sheet).getByRole("button", { name: "Call in sick" }));
    expect(mine.value.callIn).toHaveBeenCalledWith({ startsOn: "2026-11-30", endsOn: "2026-11-30", note: "" });
  });

  it("shows the quiet pending dot while the write has not reached Appwrite, and no warning", () => {
    mine.value.spells = [spell()];
    mine.value.pending = true;
    setup();
    expect(screen.getByRole("status", { name: "Queued, will sync" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no dot once it has", () => {
    mine.value.spells = [spell()];
    setup();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("a call-in still to come", () => {
  it("shows it with its dates and a Cancel, rather than saying the athlete is sick now", async () => {
    mine.value.spells = [spell({ startsOn: "2026-12-04", endsOn: "2026-12-05", note: "Dentist, then rest" })];
    const user = setup();
    const card = screen.getByRole("region", { name: "Sick, coming up" });
    expect(within(card).getByText("Sick Friday 4 Dec to Saturday 5 Dec")).toBeInTheDocument();
    expect(within(card).getByText("Dentist, then rest")).toBeInTheDocument();
    expect(screen.queryByText(/Off sick/)).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(mine.value.end).toHaveBeenCalledWith("2026-11-27");
  });

  it("does not show one that has already finished", () => {
    mine.value.spells = [spell({ startsOn: "2026-11-20", endsOn: "2026-11-22" })];
    setup();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Call in sick/ })).toBeInTheDocument();
  });
});

describe("the athlete's own screen", () => {
  it("has no streak, no guilt and no coach-facing words", () => {
    mine.value.spells = [spell()];
    setup();
    expect(document.body.textContent).not.toMatch(/streak|missed|sorry|failed|acknowledge/i);
  });

  it("does nothing on its own: no call-in is made by rendering", () => {
    setup();
    expect(mine.value.callIn).not.toHaveBeenCalled();
    expect(mine.value.end).not.toHaveBeenCalled();
    act(() => {});
  });
});
