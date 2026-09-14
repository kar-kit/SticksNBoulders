import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoachLink } from "./coach-link";

const refresh = vi.fn();
const session = vi.hoisted(() => ({ state: {} as unknown }));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({ state: session.state, refresh: vi.fn() }),
}));

const store = vi.hoisted(() => ({
  fetchMyCoach: vi.fn(),
  resolveCode: vi.fn(),
  redeemCode: vi.fn(),
  unlinkCoach: vi.fn(),
}));
vi.mock("@/lib/coach/link-store", () => store);

const CODE = "SNB-4F7K2";

beforeEach(() => {
  refresh.mockClear();
  session.state = {
    status: "signed-in",
    user: { id: "joey", name: "Joey", email: "j@e.com" },
    coach: { isCoach: false, athleteIds: [] },
  };
  store.fetchMyCoach.mockResolvedValue(null);
  store.resolveCode.mockResolvedValue({ status: "found", coachId: "ruairi", coachName: "Ruairi Deane" });
  store.redeemCode.mockResolvedValue({
    status: "linked",
    coachId: "ruairi",
    coachName: "Ruairi Deane",
    reactivated: false,
  });
  store.unlinkCoach.mockResolvedValue({ status: "unlinked", coachId: "ruairi" });
});

const typeCode = async (value = CODE) => {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Enter a coach code"), value);
  await user.click(screen.getByRole("button", { name: "Link my coach" }));
  return user;
};

describe("an athlete with no coach", () => {
  it("offers the code field", async () => {
    render(<CoachLink />);
    expect(await screen.findByText("Not linked")).toBeInTheDocument();
    expect(screen.getByLabelText("Enter a coach code")).toBeInTheDocument();
  });

  it("names the coach and states the consequence before writing anything", async () => {
    // The blueprint is explicit that this is where consent happens, so the
    // name and the sentence must both be on screen before any link exists.
    render(<CoachLink />);
    await typeCode();

    expect(await screen.findByText("Link with Ruairi Deane?")).toBeInTheDocument();
    expect(
      screen.getByText(/Ruairi Deane will be able to see your sessions, your videos and your bodyweight/),
    ).toBeInTheDocument();
    expect(store.redeemCode).not.toHaveBeenCalled();
  });

  it("links only once the athlete confirms", async () => {
    render(<CoachLink />);
    const user = await typeCode();
    await user.click(await screen.findByRole("button", { name: "Link" }));

    await waitFor(() => expect(store.redeemCode).toHaveBeenCalledWith(CODE));
    expect(await screen.findByText("Ruairi Deane")).toBeInTheDocument();
  });

  it("writes nothing if they cancel", async () => {
    render(<CoachLink />);
    const user = await typeCode();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Not linked")).toBeInTheDocument();
    expect(store.redeemCode).not.toHaveBeenCalled();
  });

  it("forgives a code typed without its prefix", async () => {
    render(<CoachLink />);
    await typeCode("4f7k2");
    await waitFor(() => expect(store.resolveCode).toHaveBeenCalledWith(CODE));
  });

  it("refuses junk without spending a lookup", async () => {
    render(<CoachLink />);
    await typeCode("nope");
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't a code/);
    expect(store.resolveCode).not.toHaveBeenCalled();
  });

  it("says so for a code nobody owns", async () => {
    store.resolveCode.mockResolvedValue({ status: "unknown-code" });
    render(<CoachLink />);
    await typeCode();
    expect(await screen.findByRole("alert")).toHaveTextContent(/don't know that code/);
  });

  it("says so when a coach redeems their own code", async () => {
    store.resolveCode.mockResolvedValue({ status: "self" });
    render(<CoachLink />);
    await typeCode();
    expect(await screen.findByRole("alert")).toHaveTextContent(/your own code/);
  });

  it("names the existing coach when a second one is refused, and admits there is no switch", async () => {
    // Someone told "already linked to Ruairi" will go looking for an unlink
    // button. There isn't one yet, so the message has to say that.
    store.redeemCode.mockResolvedValue({ status: "other-coach", coachId: "louis", coachName: "Louis Byrne" });
    render(<CoachLink />);
    const user = await typeCode();
    await user.click(await screen.findByRole("button", { name: "Link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already linked to Louis Byrne.*no way to switch yet/,
    );
  });

  it("does not claim success when the link landed but the access did not", async () => {
    store.redeemCode.mockResolvedValue({
      status: "linked-not-visible",
      coachId: "ruairi",
      coachName: "Ruairi Deane",
    });
    render(<CoachLink />);
    const user = await typeCode();
    await user.click(await screen.findByRole("button", { name: "Link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/can't see your training yet/);
  });

  it("stays usable when the server cannot be reached", async () => {
    store.resolveCode.mockImplementation(async () => {
      throw new Error("no signal");
    });
    render(<CoachLink />);
    await typeCode();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn/);
    expect(screen.getByLabelText("Enter a coach code")).toBeInTheDocument();
  });
});

describe("an athlete who already has a coach", () => {
  it("shows who it is and when, rather than a code field", async () => {
    store.fetchMyCoach.mockResolvedValue({
      coachId: "ruairi",
      coachName: "Ruairi Deane",
      linkedAt: new Date("2026-09-02T09:00:00.000Z"),
    });
    render(<CoachLink />);

    expect(await screen.findByText("Ruairi Deane")).toBeInTheDocument();
    expect(screen.getByText("linked 2 Sep")).toBeInTheDocument();
    expect(screen.queryByLabelText("Enter a coach code")).not.toBeInTheDocument();
  });

  it("falls back to the code field when the lookup cannot reach the server", async () => {
    // A basement, not an athlete without a coach -- but the field is harmless
    // here and a dead section is not.
    store.fetchMyCoach.mockImplementation(async () => {
      throw new Error("no signal");
    });
    render(<CoachLink />);
    expect(await screen.findByLabelText("Enter a coach code")).toBeInTheDocument();
  });
});

describe("a signed-out visitor", () => {
  it("is shown nothing and triggers no lookup", async () => {
    session.state = { status: "signed-out" };
    const { container } = render(<CoachLink />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(store.fetchMyCoach).not.toHaveBeenCalled();
  });
});

describe("withdrawing a coach", () => {
  const linked = () => {
    store.fetchMyCoach.mockResolvedValue({
      coachId: "ruairi",
      coachName: "Ruairi Deane",
      linkedAt: new Date("2026-09-02T09:00:00.000Z"),
    });
  };

  const openConfirm = async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unlink" }));
    return user;
  };

  it("asks first, naming the coach and what stops", async () => {
    linked();
    render(<CoachLink />);
    await openConfirm();

    expect(await screen.findByText("Unlink Ruairi Deane?")).toBeInTheDocument();
    expect(screen.getByText(/will no longer see your sessions/)).toBeInTheDocument();
    expect(store.unlinkCoach).not.toHaveBeenCalled();
  });

  it("reassures the athlete their own training is untouched", async () => {
    // The fear at this moment is losing your own log, not the coach's view.
    linked();
    render(<CoachLink />);
    await openConfirm();
    expect(await screen.findByText(/Your own training stays exactly as it is/)).toBeInTheDocument();
  });

  it("keeps the coach if they back out", async () => {
    linked();
    render(<CoachLink />);
    const user = await openConfirm();
    await user.click(await screen.findByRole("button", { name: "Keep" }));

    expect(await screen.findByText("Ruairi Deane")).toBeInTheDocument();
    expect(store.unlinkCoach).not.toHaveBeenCalled();
  });

  it("returns to the code field once unlinked", async () => {
    linked();
    render(<CoachLink />);
    const user = await openConfirm();
    const confirm = await screen.findByText("Unlink Ruairi Deane?");
    await user.click(within(confirm.parentElement!).getByRole("button", { name: "Unlink" }));

    expect(await screen.findByLabelText("Enter a coach code")).toBeInTheDocument();
    expect(store.unlinkCoach).toHaveBeenCalledTimes(1);
  });

  it("does not claim success when the access could not be removed", async () => {
    // Nothing was written and the coach may still see everything. Reporting
    // this as done would leave the athlete believing they had withdrawn.
    linked();
    store.unlinkCoach.mockResolvedValue({ status: "still-visible", coachId: "ruairi" });
    render(<CoachLink />);
    const user = await openConfirm();
    const confirm = await screen.findByText("Unlink Ruairi Deane?");
    await user.click(within(confirm.parentElement!).getByRole("button", { name: "Unlink" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Nothing changed/);
  });

  it("treats an athlete who was already unlinked as done", async () => {
    linked();
    store.unlinkCoach.mockResolvedValue({ status: "not-linked" });
    render(<CoachLink />);
    const user = await openConfirm();
    const confirm = await screen.findByText("Unlink Ruairi Deane?");
    await user.click(within(confirm.parentElement!).getByRole("button", { name: "Unlink" }));

    expect(await screen.findByLabelText("Enter a coach code")).toBeInTheDocument();
  });
});
