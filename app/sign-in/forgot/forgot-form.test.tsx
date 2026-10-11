import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForgotForm } from "./forgot-form";

const session = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));
vi.mock("@/lib/auth/session", () => session);

beforeEach(() => {
  vi.clearAllMocks();
  session.requestPasswordReset.mockResolvedValue({ ok: true, value: {} });
});

async function request(email = "joey@example.com") {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
}

describe("asking for a link", () => {
  it("states what the link does before you ask for one", () => {
    render(<ForgotForm />);
    expect(screen.getByText(/It works once and expires in an hour/)).toBeInTheDocument();
  });

  it("keeps the button inert until the address looks like one", async () => {
    render(<ForgotForm />);
    const button = screen.getByRole("button", { name: "Send reset link" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Email"), "joey@");
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Email"), "example.com");
    expect(button).toBeEnabled();
  });

  it("sends the request", async () => {
    render(<ForgotForm />);
    await request();
    expect(session.requestPasswordReset).toHaveBeenCalledWith("joey@example.com", expect.any(String));
  });

  it("offers a way back to sign in", () => {
    render(<ForgotForm />);
    expect(screen.getByRole("link", { name: /Back to sign in/ })).toHaveAttribute("href", "/sign-in");
  });
});

describe("the confirmation never reveals whether the account exists", () => {
  it("is conditional about it, in those words", async () => {
    render(<ForgotForm />);
    await request();
    expect(await screen.findByText(/If joey@example.com has an account/)).toBeInTheDocument();
  });

  it("says exactly the same thing when the request failed", async () => {
    // Appwrite may answer differently for an unknown address. This screen never
    // looks, so it cannot leak even by accident.
    session.requestPasswordReset.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    render(<ForgotForm />);
    await request();
    expect(await screen.findByText(/If joey@example.com has an account/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no error for an address with no account", async () => {
    session.requestPasswordReset.mockResolvedValue({ ok: false, failure: { kind: "unknown", message: "user_not_found" } });
    render(<ForgotForm />);
    await request("nobody@example.com");
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.queryByText(/user_not_found/)).not.toBeInTheDocument();
  });

  it("normalises the address it echoes back", async () => {
    render(<ForgotForm />);
    await request("  Joey@Example.COM  ");
    expect(await screen.findByText(/If joey@example.com has an account/)).toBeInTheDocument();
  });
});

describe("the resend cooldown", () => {
  // The countdown's clock (Date and setInterval) is fully fake: no
  // shouldAdvanceTime, so it moves only when the test moves it, and every move
  // is inside act(). setTimeout stays real because Testing Library's async
  // wrapper waits on it and cannot see Vitest's fake timers.
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] }));
  afterEach(() => vi.useRealTimers());

  /** Sends, then lets the (mocked) request settle inside act. */
  async function sendWithFakeClock() {
    const user = userEvent.setup();
    render(<ForgotForm />);
    await user.type(screen.getByLabelText("Email"), "joey@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("Check your email")).toBeInTheDocument();
  }

  it("counts down before another can be sent", async () => {
    await sendWithFakeClock();
    const resend = screen.getByRole("button", { name: "Resend link" });

    expect(resend).toBeDisabled();
    expect(screen.getByText("Resend in 1:00")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(resend).toBeDisabled();
    expect(screen.getByText("Resend in 0:30")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(resend).toBeEnabled();
    expect(screen.getByText("You can ask for another one")).toBeInTheDocument();
  });

  it("starts the cooldown again after a resend", async () => {
    await sendWithFakeClock();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Resend link" }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(session.requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Resend link" })).toBeDisabled();
    expect(screen.getByText("Resend in 1:00")).toBeInTheDocument();
  });

  it("never shows an enabled Resend, even for one frame", async () => {
    // The confirmation used to commit once with the cooldown still at 0 and
    // only disable the button on the next render. A DOM observer sees that
    // flip as a mutation of the button's `disabled` attribute, however fast
    // the second render follows.
    let settle!: (value: unknown) => void;
    session.requestPasswordReset.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    const user = userEvent.setup();
    render(<ForgotForm />);
    await user.type(screen.getByLabelText("Email"), "joey@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
    await act(async () => {
      settle({ ok: true, value: {} });
      await vi.advanceTimersByTimeAsync(0);
    });
    records.push(...observer.takeRecords());
    observer.disconnect();

    const resend = screen.getByRole("button", { name: "Resend link" });
    expect(resend).toBeDisabled();
    expect(records.filter((r) => r.type === "attributes" && r.target === resend)).toEqual([]);
  });
});
