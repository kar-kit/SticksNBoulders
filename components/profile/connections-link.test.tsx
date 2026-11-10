import { render, screen } from "@testing-library/react";
import { ConnectionsLink } from "./connections-link";

const store = vi.hoisted(() => ({ mayUseConnections: vi.fn() }));
vi.mock("@/lib/api/token-store", () => store);

describe("the Connections row on Me (F29)", () => {
  it("appears once the server says this user is allowed", async () => {
    store.mayUseConnections.mockResolvedValue(true);
    render(<ConnectionsLink userId="joey" />);
    expect(await screen.findByRole("link", { name: /Connections/ })).toHaveAttribute("href", "/me/connections");
    expect(store.mayUseConnections).toHaveBeenCalledWith("joey");
  });

  it("never appears for anyone else, or when the check fails", async () => {
    store.mayUseConnections.mockResolvedValueOnce(false);
    const { container, unmount } = render(<ConnectionsLink userId="sam" />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    unmount();

    store.mayUseConnections.mockRejectedValueOnce(new Error("offline"));
    const second = render(<ConnectionsLink userId="sam" />);
    await Promise.resolve();
    expect(second.container).toBeEmptyDOMElement();
  });
});
