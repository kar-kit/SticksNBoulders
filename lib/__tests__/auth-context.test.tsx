import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../auth-context";
import { account, tablesDB } from "../appwrite";

jest.mock("../appwrite", () => ({
  account: { get: jest.fn() },
  tablesDB: { getRow: jest.fn() },
}));

const accountGet = account.get as jest.Mock;
const getRow = tablesDB.getRow as jest.Mock;

function AuthProbe() {
  const { loading, user, profile } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>done user={String(!!user)} profile={String(!!profile)}</div>;
}

describe("AuthProvider", () => {
  beforeEach(() => {
    accountGet.mockReset();
    getRow.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves loading once account.get and getRow settle", async () => {
    accountGet.mockResolvedValue({ $id: "user-1" });
    getRow.mockResolvedValue({ $id: "user-1", displayName: "Test" });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText(/done/)).toBeInTheDocument());
    expect(screen.getByText(/done user=true profile=true/)).toBeInTheDocument();
  });

  // Regression test for the "double-tap home button hangs the app" bug: a
  // backgrounded/suspended tab can leave account.get() pending forever --
  // neither resolving nor rejecting -- which previously left `loading` stuck
  // `true` and every gated screen spinning indefinitely.
  it("stops loading after a timeout even if account.get never settles", async () => {
    accountGet.mockReturnValue(new Promise(() => {})); // never resolves or rejects

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(screen.getByText("loading")).toBeInTheDocument();

    jest.advanceTimersByTime(10000);

    await waitFor(() => expect(screen.getByText(/done/)).toBeInTheDocument());
    expect(screen.getByText(/done user=false profile=false/)).toBeInTheDocument();
  });

  it("does not time out early for a slow but eventually-successful auth check", async () => {
    let resolveAccount: (value: { $id: string }) => void;
    accountGet.mockReturnValue(
      new Promise((resolve) => {
        resolveAccount = resolve;
      })
    );
    getRow.mockResolvedValue({ $id: "user-1" });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    jest.advanceTimersByTime(5000);
    expect(screen.getByText("loading")).toBeInTheDocument();

    resolveAccount!({ $id: "user-1" });
    await waitFor(() => expect(screen.getByText(/done/)).toBeInTheDocument());
    expect(screen.getByText(/done user=true/)).toBeInTheDocument();
  });
});
