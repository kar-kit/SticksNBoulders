import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignInForm } from "./sign-in-form";
import { enabledProviders } from "@/lib/auth/providers";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  currentUser: vi.fn(),
  fetchMethodHint: vi.fn(),
  startOAuth: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => session);

const GOOGLE_ONLY = enabledProviders();
const BOTH = enabledProviders({ appleEnabled: true });

function setup(providers = GOOGLE_ONLY) {
  return render(<SignInForm providers={providers} destination="/today" />);
}

async function submitCredentials(email = "joey@example.com", password = "hunter2222") {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  session.currentUser.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
  session.fetchMethodHint.mockResolvedValue(null);
});

describe("the three routes in", () => {
  it("offers Google and the email form", () => {
    setup();
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("hides Apple until it is configured", () => {
    setup();
    expect(screen.queryByRole("button", { name: /Continue with Apple/ })).not.toBeInTheDocument();
  });

  it("shows Apple above Google when enabled", () => {
    setup(BOTH);
    const buttons = screen.getAllByRole("button", { name: /Continue with/ });
    expect(buttons.map((b) => b.textContent)).toEqual(["Continue with Apple", "Continue with Google"]);
  });

  it("starts the OAuth redirect on tap", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    expect(session.startOAuth).toHaveBeenCalledWith("google", expect.any(String));
  });

  it("sets the autocomplete attributes password managers need", () => {
    // This is what actually removes password friction, not the absence of one.
    setup();
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });
});

describe("signing in", () => {
  it("lands on the destination when it works", async () => {
    session.signInWithPassword.mockResolvedValue({ ok: true, value: {} });
    setup();
    await submitCredentials();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/today"));
  });

  it("shows a wrong password inline, never as a toast", async () => {
    session.signInWithPassword.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    setup();
    await submitCredentials();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That email and password don't match.");
  });

  it("never reveals whether the email exists", async () => {
    session.signInWithPassword.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    setup();
    await submitCredentials();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.toLowerCase()).not.toMatch(/no account|not found|doesn't exist/);
  });

  it("offers the reset link beside a failed password", async () => {
    session.signInWithPassword.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    setup();
    await submitCredentials();
    expect(await screen.findByRole("link", { name: /Forgot your password/ })).toBeInTheDocument();
  });

  it("says plainly when the problem is being offline", async () => {
    session.signInWithPassword.mockResolvedValue({ ok: false, failure: { kind: "offline" } });
    setup();
    await submitCredentials();
    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
  });
});

describe("the account-created-with-Google trap", () => {
  it("asks the server only after a password attempt has already failed", async () => {
    session.signInWithPassword.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    setup();
    expect(session.fetchMethodHint).not.toHaveBeenCalled();
    await submitCredentials();
    await waitFor(() => expect(session.fetchMethodHint).toHaveBeenCalledWith("joey@example.com"));
  });

  it("names the provider and puts its button right there", async () => {
    session.signInWithPassword.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    session.fetchMethodHint.mockResolvedValue("google");
    setup();
    await submitCredentials();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You signed up with Google. Continue with Google.");
    expect(within(alert).getByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
  });

  it("does not offer a password reset for an account with no password", async () => {
    // That email is a dead end: there is nothing to reset.
    session.signInWithPassword.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    session.fetchMethodHint.mockResolvedValue("google");
    setup();
    await submitCredentials();
    const alert = await screen.findByRole("alert");
    expect(within(alert).queryByRole("link", { name: /Forgot your password/ })).not.toBeInTheDocument();
  });

  it("keeps the generic message when the server has no hint", async () => {
    session.signInWithPassword.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    session.fetchMethodHint.mockResolvedValue(null);
    setup();
    await submitCredentials();
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password don't match.");
  });

  it("does not ask for a hint on the create-account path", async () => {
    session.signUpWithPassword.mockResolvedValue({ ok: false, failure: { kind: "email-taken" } });
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.type(screen.getByLabelText("Email"), "joey@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2222");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(session.fetchMethodHint).not.toHaveBeenCalled();
  });
});

describe("creating an account", () => {
  it("toggles to the create form on the same screen", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("states the password requirement before submission, not after", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText(/At least 8 characters/)).toBeInTheDocument();
  });

  it("clears a stale error when switching mode", async () => {
    session.signInWithPassword.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    setup();
    await submitCredentials();
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the email is already taken", async () => {
    session.signUpWithPassword.mockResolvedValue({ ok: false, failure: { kind: "email-taken" } });
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.type(screen.getByLabelText("Email"), "joey@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2222");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already an account/i);
  });
});

describe("already signed in", () => {
  it("skips the screen entirely", async () => {
    session.currentUser.mockResolvedValue({ ok: true, value: { name: "Joey", email: "j@e.com" } });
    setup();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/today"));
  });

  it("stays put when there is no session", async () => {
    setup();
    await waitFor(() => expect(session.currentUser).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("the password field", () => {
  it("can be revealed and hidden again", async () => {
    setup();
    const field = screen.getByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(field).toHaveAttribute("type", "password");
  });
});

describe("an account with no password and no nameable provider", () => {
  it("says so, and offers no reset", async () => {
    session.signInWithPassword.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    session.fetchMethodHint.mockResolvedValue("other");
    setup();
    await submitCredentials();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That account doesn't use a password.");
    expect(within(alert).queryByRole("link", { name: /Forgot your password/ })).not.toBeInTheDocument();
  });
});
