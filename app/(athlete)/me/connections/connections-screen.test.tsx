import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionsScreen } from "./connections-screen";
import type { TokenSummary } from "@/lib/api/connections";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "joey", name: "Joey", email: "j@e.com" } },
    refresh: vi.fn(),
  }),
}));

const TOKEN = `snb_pat_${"Q".repeat(43)}`;
const live = (id: string, label: string, extra: Partial<TokenSummary> = {}): TokenSummary => ({
  id,
  label,
  scope: "read",
  createdAt: "2026-11-10T09:00:00.000Z",
  expiresAt: "2027-02-08T09:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  state: "live",
  ...extra,
});

const store = vi.hoisted(() => ({
  fetchTokenAccess: vi.fn(),
  mintToken: vi.fn(),
  revokeToken: vi.fn(async () => {}),
}));
vi.mock("@/lib/api/token-store", () => store);

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
  store.fetchTokenAccess.mockReset();
  store.mintToken.mockReset();
  store.revokeToken.mockClear();
});

describe("Me, Connections (F29)", () => {
  it("sends anyone the server does not allow back to Me, showing nothing", async () => {
    store.fetchTokenAccess.mockResolvedValue({ allowed: false });
    const { container } = render(<ConnectionsScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/me"));
    expect(container).toBeEmptyDOMElement();
  });

  it("has a real empty state", async () => {
    store.fetchTokenAccess.mockResolvedValue({ allowed: true, tokens: [], maxLive: 5 });
    render(<ConnectionsScreen />);
    expect(await screen.findByText("No tokens yet")).toBeInTheDocument();
  });

  it("lists tokens with their dates, last use and state, and never shows a token after the fact", async () => {
    store.fetchTokenAccess.mockResolvedValue({
      allowed: true,
      maxLive: 5,
      tokens: [
        live("t1", "Rubble", { lastUsedAt: "2026-11-10T10:00:00.000Z" }),
        live("t2", "Old laptop", { state: "revoked", revokedAt: "2026-11-09T10:00:00.000Z" }),
      ],
    });
    render(<ConnectionsScreen />);
    const list = await screen.findByRole("list", { name: "Tokens" });
    expect(list).toHaveTextContent("Rubble");
    expect(list).toHaveTextContent("Active");
    expect(list).toHaveTextContent("Last used 10 Nov 2026");
    expect(list).toHaveTextContent("Expires 8 Feb 2027");
    expect(list).toHaveTextContent("Revoked 9 Nov 2026");
    expect(screen.queryByText(/snb_pat_/)).not.toBeInTheDocument();
    // Revoked tokens have nothing left to revoke.
    expect(screen.getAllByRole("button", { name: /^Revoke / })).toHaveLength(1);
  });

  it("creates a token with a label and expiry, shows it once with a copy button, then lets it go", async () => {
    store.fetchTokenAccess.mockResolvedValue({ allowed: true, tokens: [], maxLive: 5 });
    store.mintToken.mockResolvedValue({ id: "t9", token: TOKEN, expiresAt: "2027-11-10T09:00:00.000Z", label: "Rubble" });
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ConnectionsScreen />);

    await user.type(await screen.findByLabelText("Token label"), "Rubble");
    await user.click(screen.getByRole("radio", { name: "365 days" }));
    store.fetchTokenAccess.mockResolvedValue({ allowed: true, tokens: [live("t9", "Rubble")], maxLive: 5 });
    await user.click(screen.getByRole("button", { name: "Create token" }));

    expect(store.mintToken).toHaveBeenCalledWith("Rubble", 365);
    const shown = await screen.findByRole("region", { name: "Your new token" });
    expect(shown).toHaveTextContent(TOKEN);
    expect(shown).toHaveTextContent("It won’t be shown again");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(TOKEN);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
  });

  it("asks for a label rather than minting a nameless token", async () => {
    store.fetchTokenAccess.mockResolvedValue({ allowed: true, tokens: [], maxLive: 5 });
    render(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Create token" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/label/);
    expect(store.mintToken).not.toHaveBeenCalled();
  });

  it("stops offering to create at the cap", async () => {
    store.fetchTokenAccess.mockResolvedValue({
      allowed: true,
      maxLive: 5,
      tokens: ["a", "b", "c", "d", "e"].map((id) => live(id, id)),
    });
    render(<ConnectionsScreen />);
    expect(await screen.findByRole("button", { name: "Create token" })).toBeDisabled();
    expect(screen.getByText(/5 active tokens is the limit/)).toBeInTheDocument();
  });

  it("revokes only after a confirm", async () => {
    store.fetchTokenAccess.mockResolvedValue({ allowed: true, tokens: [live("t1", "Rubble")], maxLive: 5 });
    const user = userEvent.setup();
    render(<ConnectionsScreen />);
    await user.click(await screen.findByRole("button", { name: "Revoke Rubble" }));
    expect(store.revokeToken).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Anything using it stops working");

    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(store.revokeToken).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Revoke Rubble" }));
    store.fetchTokenAccess.mockResolvedValue({ allowed: true, tokens: [live("t1", "Rubble", { state: "revoked", revokedAt: "2026-11-10T11:00:00.000Z" })], maxLive: 5 });
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(store.revokeToken).toHaveBeenCalledWith("t1");
    expect(await screen.findByText("Revoked")).toBeInTheDocument();
  });
});
