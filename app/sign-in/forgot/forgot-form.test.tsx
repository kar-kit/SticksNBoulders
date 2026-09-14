import { render, screen, waitFor } from "@testing-library/react";
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
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("counts down before another can be sent", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ForgotForm />);
    await user.type(screen.getByLabelText("Email"), "joey@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByText("Check your email");

    expect(screen.getByRole("button", { name: "Resend link" })).toBeDisabled();
    expect(screen.getByText(/Resend in 1:00|Resend in 0:5\d/)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(61_000);
    await waitFor(() => expect(screen.getByRole("button", { name: "Resend link" })).toBeEnabled());
    expect(screen.getByText("You can ask for another one")).toBeInTheDocument();
  });
});
