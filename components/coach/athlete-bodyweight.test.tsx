import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AthleteBodyweight } from "./athlete-bodyweight";
import { addDays } from "@/lib/programming/program";
import { dayKey } from "@/lib/bodyweight/bodyweight";

const store = vi.hoisted(() => ({ fetchBodyweight: vi.fn() }));
vi.mock("@/lib/bodyweight/store", () => store);

const today = dayKey();

/** Fourteen days of weigh-ins, newest first as the store returns them, dropping 0.1kg a day. */
const fortnight = () =>
  Array.from({ length: 14 }, (_, back) => ({
    id: `bw-${back}`,
    athleteId: "joey",
    weightKg: 82 + back * 0.1,
    measuredOn: addDays(today, -back),
  }));

beforeEach(() => {
  store.fetchBodyweight.mockReset();
});

const props = { athleteId: "joey", open: false, onOpen: vi.fn(), onClose: vi.fn() };

describe("the header figure", () => {
  it("is the current weight and the 7-day average, as a button", async () => {
    store.fetchBodyweight.mockResolvedValue(fortnight());
    render(<AthleteBodyweight {...props} />);
    const button = await screen.findByRole("button", { name: /Bodyweight/ });
    expect(button).toHaveTextContent("82.0 kg");
    expect(button).toHaveTextContent("7-day 82.3 −0.7");
  });

  it("asks for the history to open when clicked", async () => {
    const onOpen = vi.fn();
    store.fetchBodyweight.mockResolvedValue(fortnight());
    const user = userEvent.setup();
    render(<AthleteBodyweight {...props} onOpen={onOpen} />);
    await user.click(await screen.findByRole("button", { name: /Bodyweight/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("dates a weigh-in too old for an average, so it is not read as this morning's", async () => {
    store.fetchBodyweight.mockResolvedValue([{ id: "old", athleteId: "joey", weightKg: 83.4, measuredOn: addDays(today, -20) }]);
    render(<AthleteBodyweight {...props} />);
    const button = await screen.findByRole("button", { name: /Bodyweight/ });
    expect(button).toHaveTextContent("83.4 kg");
    expect(button).toHaveTextContent("last weighed");
    expect(button).not.toHaveTextContent("7-day");
  });

  it("says plainly when nothing is logged, with nothing to open", async () => {
    store.fetchBodyweight.mockResolvedValue([]);
    render(<AthleteBodyweight {...props} />);
    expect(await screen.findByText(/No weigh-ins yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is quiet when the read fails", async () => {
    store.fetchBodyweight.mockRejectedValue(new Error("offline"));
    const { container } = render(<AthleteBodyweight {...props} />);
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("the history", () => {
  it("opens over the page with the chart, its rolling average and the weigh-ins listed", async () => {
    store.fetchBodyweight.mockResolvedValue(fortnight());
    render(<AthleteBodyweight {...props} open />);
    const dialog = await screen.findByRole("dialog", { name: "Bodyweight" });
    expect(within(dialog).getByRole("img", { name: "Their bodyweight over the last 90 days" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(14);
    expect(within(dialog).getByText(/7-day average 82.3 −0.7 on the week before/)).toBeInTheDocument();
  });

  it("switches range", async () => {
    store.fetchBodyweight.mockResolvedValue(fortnight());
    const user = userEvent.setup();
    render(<AthleteBodyweight {...props} open />);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "all" }));
    expect(within(dialog).getByRole("button", { name: "all" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("img", { name: "Their bodyweight over all of their history" })).toBeInTheDocument();
  });

  it("closes through the caller, from the button and from Escape", async () => {
    const onClose = vi.fn();
    store.fetchBodyweight.mockResolvedValue(fortnight());
    const user = userEvent.setup();
    const { unmount } = render(<AthleteBodyweight {...props} open onClose={onClose} />);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    render(<AthleteBodyweight {...props} open onClose={onClose} />);
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }).focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
