import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResetForm } from "./reset-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session = vi.hoisted(() => ({
  completePasswordReset: vi.fn(),
  signInWithPassword: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => session);

const TOKEN = { userId: "u1", secret: "s3cr3t" };

beforeEach(() => {
  vi.clearAllMocks();
  session.completePasswordReset.mockResolvedValue({ ok: true, value: {} });
  session.signInWithPassword.mockResolvedValue({ ok: true, value: {} });
});

// Note the explicit object rather than a default parameter: passing
// `undefined` to a defaulted parameter uses the default, which quietly made
// the no-email case test the with-email path instead.
function setup(props: { email?: string } = { email: "joey@example.com" }) {
  return render(<ResetForm token={TOKEN} email={props.email} destination="/" />);
}

async function fill(password: string, confirmation = password) {
  await userEvent.type(screen.getByLabelText("New password"), password);
  await userEvent.type(screen.getByLabelText("Confirm"), confirmation);
  await userEvent.click(screen.getByRole("button", { name: "Save and sign in" }));
}

describe("choosing a new password", () => {
  it("says which account is being changed", () => {
    setup();
    expect(screen.getByText("Signed in as joey@example.com once this is saved.")).toBeInTheDocument();
  });

  it("states the rule before submission, and states that there are no others", () => {
    setup();
    expect(screen.getByText("At least 8 characters. Nothing else required.")).toBeInTheDocument();
  });

  it("marks both fields as new-password so a manager offers to save it", () => {
    setup();
    expect(screen.getByLabelText("New password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirm")).toHaveAttribute("autocomplete", "new-password");
  });

  it("saves and signs in, landing on the destination", async () => {
    setup();
    await fill("hunter2222");
    expect(session.completePasswordReset).toHaveBeenCalledWith("u1", "s3cr3t", "hunter2222");
    expect(session.signInWithPassword).toHaveBeenCalledWith("joey@example.com", "hunter2222");
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("sends to sign-in when the address is unknown, rather than guessing", async () => {
    setup({});
    await fill("hunter2222");
    expect(session.signInWithPassword).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });
});

describe("validation happens before the request", () => {
  it("rejects a short password without calling Appwrite", async () => {
    setup();
    await fill("short");
    expect(screen.getByRole("alert")).toHaveTextContent("At least 8 characters.");
    expect(session.completePasswordReset).not.toHaveBeenCalled();
  });

  it("rejects a mismatch without calling Appwrite", async () => {
    setup();
    await fill("hunter2222", "hunter2223");
    expect(screen.getByRole("alert")).toHaveTextContent("Those two don't match.");
    expect(session.completePasswordReset).not.toHaveBeenCalled();
  });

  it("accepts a password with no symbols or digits", async () => {
    setup();
    await fill("allloweralpha");
    expect(session.completePasswordReset).toHaveBeenCalled();
  });
});

describe("a link that has been used or has expired", () => {
  it("changes the screen rather than nagging", async () => {
    session.completePasswordReset.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    setup();
    await fill("hunter2222");
    expect(await screen.findByText("That link has expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/sign-in/forgot");
  });

  it("keeps the form when the problem is the connection, not the link", async () => {
    // The link is still good. Telling them to request a new one would waste it.
    session.completePasswordReset.mockResolvedValue({ ok: false, failure: { kind: "offline" } });
    setup();
    await fill("hunter2222");
    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
    expect(screen.queryByText("That link has expired")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and sign in" })).toBeInTheDocument();
  });

  it("does not sign anyone in when the reset failed", async () => {
    session.completePasswordReset.mockResolvedValue({ ok: false, failure: { kind: "invalid-credentials" } });
    setup();
    await fill("hunter2222");
    expect(session.signInWithPassword).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
