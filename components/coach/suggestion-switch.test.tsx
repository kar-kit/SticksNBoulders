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

/** The radios live behind the compact control; this opens it like a coach would. */
const openSettings = async (user = userEvent.setup()) => {
  await user.click(await screen.findByRole("button", { name: /Load suggestions/ }));
  return user;
};

describe("SuggestionSwitch", () => {
  it("shows the coach's current choice for this athlete", async () => {
    store.fetchLinkRows.mockResolvedValue([row({ suggestionsMode: "held" })]);
    render(<SuggestionSwitch athleteId="joey" />);
    await openSettings();
    expect(await screen.findByRole("radio", { name: /Hold them back/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Athlete sees them directly/ })).not.toBeChecked();
  });

  it("reads a link from before Order 28 as direct", async () => {
    store.fetchLinkRows.mockResolvedValue([row()]);
    render(<SuggestionSwitch athleteId="joey" />);
    await openSettings();
    expect(await screen.findByRole("radio", { name: /Athlete sees them directly/ })).toBeChecked();
  });

  it("saves a change through the route, for this athlete", async () => {
    store.fetchLinkRows.mockResolvedValue([row({ suggestionsMode: "direct" })]);
    save.saveSuggestionMode.mockResolvedValue("held");
    const user = userEvent.setup();
    render(<SuggestionSwitch athleteId="joey" />);
    await openSettings(user);
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
    await openSettings(user);
    await user.click(await screen.findByRole("radio", { name: /Hold them back/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/still “Athlete sees them directly”/);
    expect(screen.getByRole("radio", { name: /Athlete sees them directly/ })).toBeChecked();
  });

  it("shows only the current setting until the coach asks for the choice", async () => {
    // Joey, 16 Oct 2026: no longer front and centre. A compact control in the
    // header, the radios and their explanations folded away.
    store.fetchLinkRows.mockResolvedValue([row({ suggestionsMode: "held" })]);
    render(<SuggestionSwitch athleteId="joey" />);
    const trigger = await screen.findByRole("button", { name: /Load suggestions/ });
    await waitFor(() => expect(trigger).toHaveTextContent("Hold them back"));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/repeats the last set/)).not.toBeInTheDocument();
  });

  it("folds away on Escape and hands focus back to the control", async () => {
    store.fetchLinkRows.mockResolvedValue([row({ suggestionsMode: "direct" })]);
    render(<SuggestionSwitch athleteId="joey" />);
    const user = await openSettings();
    const trigger = screen.getByRole("button", { name: /Load suggestions/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("radio", { name: /Athlete sees them directly/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("folds away on Escape while a choice is still saving, when focus has left the panel", async () => {
    // Choosing disables the radios until the write answers, which drops
    // focus to the page; Escape from there must still close it.
    store.fetchLinkRows.mockResolvedValue([row({ suggestionsMode: "direct" })]);
    save.saveSuggestionMode.mockReturnValue(new Promise(() => {}));
    render(<SuggestionSwitch athleteId="joey" />);
    const user = await openSettings();
    await user.click(screen.getByRole("radio", { name: /Hold them back/ }));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Load suggestions/ })).toHaveFocus();
  });

  it("folds away on a click elsewhere", async () => {
    store.fetchLinkRows.mockResolvedValue([row({ suggestionsMode: "direct" })]);
    render(<SuggestionSwitch athleteId="joey" />);
    const user = await openSettings();
    await user.click(document.body);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("keeps a refused write's sentence on screen after it folds away", async () => {
    store.fetchLinkRows.mockResolvedValue([row({ suggestionsMode: "direct" })]);
    save.saveSuggestionMode.mockRejectedValue(new Error("403"));
    render(<SuggestionSwitch athleteId="joey" />);
    const user = await openSettings();
    await user.click(screen.getByRole("radio", { name: /Hold them back/ }));
    await screen.findByRole("alert");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alert")).toHaveTextContent(/still “Athlete sees them directly”/);
    expect(screen.getByRole("button", { name: /Load suggestions/ })).toHaveTextContent("Athlete sees them directly");
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
