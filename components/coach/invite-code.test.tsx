import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteCodePanel } from "./invite-code";

const session = vi.hoisted(() => ({
  state: {
    status: "signed-in",
    user: { id: "ruairi", name: "Ruairi", email: "r@e.com" },
    coach: { isCoach: false, athleteIds: [] as string[] },
  } as unknown,
}));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({ state: session.state, refresh: vi.fn() }),
}));

const store = vi.hoisted(() => ({
  fetchMyInviteCode: vi.fn(),
  mintInviteCode: vi.fn(),
}));
vi.mock("@/lib/coach/invite-store", () => store);

const signedIn = (athleteIds: string[] = []) => {
  session.state = {
    status: "signed-in",
    user: { id: "ruairi", name: "Ruairi", email: "r@e.com" },
    coach: { isCoach: athleteIds.length > 0, athleteIds },
  };
};

beforeEach(() => {
  signedIn();
  store.fetchMyInviteCode.mockResolvedValue(null);
  store.mintInviteCode.mockResolvedValue("SNB-4F7K2");
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("a coach with no code yet", () => {
  it("offers to get one, without pretending to be a coach screen", async () => {
    render(<InviteCodePanel />);
    expect(await screen.findByRole("button", { name: "Invite an athlete" })).toBeInTheDocument();
  });

  it("shows the code the server hands back", async () => {
    render(<InviteCodePanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Invite an athlete" }));
    expect(await screen.findByText("SNB-4F7K2")).toBeInTheDocument();
  });

  it("says so and stays tappable when the server cannot be reached", async () => {
    // Offline is normal. The button must come back, not leave a dead screen.
    store.mintInviteCode.mockImplementation(async () => {
      throw new Error("no signal");
    });
    render(<InviteCodePanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Invite an athlete" }));
    expect(await screen.findByText(/Couldn/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite an athlete" })).toBeEnabled();
  });

  it("does not mint twice while the first request is in flight", async () => {
    let release: (code: string) => void = () => {};
    store.mintInviteCode.mockReturnValue(new Promise<string>((r) => (release = r)));
    render(<InviteCodePanel />);

    const button = await screen.findByRole("button", { name: "Invite an athlete" });
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: /Getting a code/ })).toBeDisabled();

    release("SNB-4F7K2");
    await screen.findByText("SNB-4F7K2");
    expect(store.mintInviteCode).toHaveBeenCalledTimes(1);
  });
});

describe("a coach who already has one", () => {
  // Braces, not a concise arrow: mockResolvedValue returns the mock, and a
  // hook that returns a function has that function called as its teardown.
  beforeEach(() => {
    store.fetchMyInviteCode.mockResolvedValue("SNB-8HJQ3");
  });

  it("shows it without asking the server to mint anything", async () => {
    render(<InviteCodePanel />);
    expect(await screen.findByText("SNB-8HJQ3")).toBeInTheDocument();
    expect(store.mintInviteCode).not.toHaveBeenCalled();
  });

  it("copies it and says it did", async () => {
    render(<InviteCodePanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("SNB-8HJQ3");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("keeps the code on screen when the clipboard refuses", async () => {
    // An insecure origin or an older iOS. The code is selectable text, so this
    // is a lost convenience, not a lost code, and it earns no error message.
    navigator.clipboard.writeText = vi.fn().mockImplementation(async () => {
      throw new Error("denied");
    });
    render(<InviteCodePanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    expect(screen.getByText("SNB-8HJQ3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("counts the athletes once there are any", async () => {
    signedIn(["joey", "sam"]);
    render(<InviteCodePanel />);
    expect(await screen.findByText("2 athletes linked")).toBeInTheDocument();
  });

  it("counts one athlete without pluralising", async () => {
    signedIn(["joey"]);
    render(<InviteCodePanel />);
    expect(await screen.findByText("1 athlete linked")).toBeInTheDocument();
  });

  it("falls back to the button when the code cannot be read", async () => {
    // A basement, not a coach without a code -- and the button is the right
    // answer either way, because minting returns the code they already have.
    store.fetchMyInviteCode.mockImplementation(async () => {
      throw new Error("no signal");
    });
    render(<InviteCodePanel />);
    expect(await screen.findByRole("button", { name: "Invite an athlete" })).toBeInTheDocument();
  });
});

describe("on a screen that already explains itself", () => {
  it("drops the label and the sentence the Roster's empty state already says", async () => {
    store.fetchMyInviteCode.mockResolvedValue("SNB-8HJQ3");
    render(<InviteCodePanel labelled={false} />);
    expect(await screen.findByText("SNB-8HJQ3")).toBeInTheDocument();
    expect(screen.queryByText("COACHING")).not.toBeInTheDocument();
    expect(screen.queryByText(/appear on your roster/)).not.toBeInTheDocument();
  });

  it("still says when the server could not be reached", async () => {
    // The one line that is never redundant: nothing else on the screen can
    // explain why the button did nothing.
    store.mintInviteCode.mockImplementation(async () => {
      throw new Error("no signal");
    });
    render(<InviteCodePanel labelled={false} />);
    await userEvent.click(await screen.findByRole("button", { name: "Invite an athlete" }));
    expect(await screen.findByText(/Couldn/)).toBeInTheDocument();
  });
});

describe("a signed-out visitor", () => {
  it("is shown nothing and triggers no read", async () => {
    session.state = { status: "signed-out" };
    const { container } = render(<InviteCodePanel />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(store.fetchMyInviteCode).not.toHaveBeenCalled();
  });
});
