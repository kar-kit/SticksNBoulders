import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestionSwitch } from "./suggestion-switch";

const store = vi.hoisted(() => ({ fetchLinkRows: vi.fn() }));
vi.mock("@/lib/coach/athlete-view-store", () => store);

const save = vi.hoisted(() => ({ saveSuggestionMode: vi.fn() }));
vi.mock("@/lib/coach/suggestion-mode-store", () => save);

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "coach", name: "Ruairi", email: "" }, coach: { isCoach: true, athleteIds: ["joey"] } },
    refresh: vi.fn(),
  }),
}));

const row = (overrides: Record<string, unknown> = {}) => ({
  coachId: "coach",
  athleteId: "joey",
  status: "active",
  linkedAt: "2026-09-20T10:00:00.000Z",
  revokedAt: null,
  ...overrides,
});

beforeEach(() => {
  store.fetchLinkRows.mockReset();
  save.saveSuggestionMode.mockReset();
});

describe("SuggestionSwitch", () => {
  it("shows the coach's current choice for this athlete", async () => {
    store.fetchLinkRows.mockResolvedValue([row({ suggestionsMode: "held" })]);
    render(<SuggestionSwitch athleteId="joey" />);
    expect(await screen.findByRole("radio", { name: /Hold them back/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Athlete sees them directly/ })).not.toBeChecked();
  });

  it("reads a link from before Order 28 as direct", async () => {
    store.fetchLinkRows.mockResolvedValue([row()]);
    render(<SuggestionSwitch athleteId="joey" />);
    expect(await screen.findByRole("radio", { name: /Athlete sees them directly/ })).toBeChecked();
  });

  it("saves a change through the route, for this athlete", async () => {
    store.fetchLinkRows.mockResolvedValue([row({ suggestionsMode: "direct" })]);
    save.saveSuggestionMode.mockResolvedValue("held");
    const user = userEvent.setup();
    render(<SuggestionSwitch athleteId="joey" />);
    await user.click(await screen.findByRole("radio", { name: /Hold them back/ }));

    expect(save.saveSuggestionMode).toHaveBeenCalledWith("joey", "held");
    await waitFor(() => expect(screen.getByRole("radio", { name: /Hold them back/ })).toBeChecked());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts the switch back and says so when the write is refused", async () => {
    store.fetchLinkRows.mockResolvedValue([row({ suggestionsMode: "direct" })]);
    save.saveSuggestionMode.mockRejectedValue(Object.assign(new Error("403"), { code: 403 }));
    const user = userEvent.setup();
    render(<SuggestionSwitch athleteId="joey" />);
    await user.click(await screen.findByRole("radio", { name: /Hold them back/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/still “Athlete sees them directly”/);
    expect(screen.getByRole("radio", { name: /Athlete sees them directly/ })).toBeChecked();
  });

  it("renders nothing without an active link", async () => {
    store.fetchLinkRows.mockResolvedValue([row({ status: "revoked" })]);
    const { container } = render(<SuggestionSwitch athleteId="joey" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(save.saveSuggestionMode).not.toHaveBeenCalled();
  });

  it("renders nothing when the link cannot be read, rather than guessing", async () => {
    store.fetchLinkRows.mockRejectedValue(new Error("offline"));
    const { container } = render(<SuggestionSwitch athleteId="joey" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
