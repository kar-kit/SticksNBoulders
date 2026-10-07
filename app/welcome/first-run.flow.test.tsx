import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Query } from "appwrite";
import { AthleteProviders } from "@/app/(athlete)/providers";
import { Landing } from "@/app/landing";
import { WelcomeScreen } from "@/app/welcome/welcome-screen";
import { forgetCircle } from "@/lib/auth/circle";
import { SessionProvider } from "@/lib/auth/session-context";
import { forgetUser } from "@/lib/auth/remembered-user";
import { forgetProfile } from "@/lib/profile/profile-store";

/**
 * The first run, end to end, with Appwrite faked at the network boundary and
 * nothing else: the session, the landing table, the welcome form, the profile
 * write and its provenance check, the prefs merge and the shells' last-used
 * write are all the real code.
 *
 * Written because two bugs reached Joey through a green suite that mocked the
 * failure away. The fake therefore keeps Appwrite's two rules that bit before:
 * `updatePrefs` REPLACES the stored object, and a row stamped with a `team:`
 * role is refused unless the writer is in that team.
 */

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/",
}));

interface Row {
  $id: string;
  $permissions: string[];
  [key: string]: unknown;
}

const server = vi.hoisted(() => ({
  online: true,
  user: { $id: "u1", name: "Ruairi", email: "ruairi@example.com" },
  prefs: {} as Record<string, unknown>,
  tables: new Map<string, Map<string, Row>>(),
  circles: new Set<string>(),
  prefWrites: 0,
  /** Reads of these rows fail once, the way a read on a train does. */
  flakyReads: 0,
}));

const table = (id: string) => {
  if (!server.tables.has(id)) server.tables.set(id, new Map());
  return server.tables.get(id)!;
};

const unreachable = () => {
  throw new TypeError("Failed to fetch");
};

/** Only `equal` is honoured; limit and select do not change what a test sees. */
function matches(row: Row, queries: string[]): boolean {
  return queries.every((raw) => {
    const q = JSON.parse(raw) as { method: string; attribute?: string; values?: unknown[] };
    if (q.method !== "equal") return true;
    return (q.values ?? []).includes(row[q.attribute!]);
  });
}

function refuseForeignTeams(permissions: string[] = []) {
  for (const permission of permissions) {
    const team = /team:([^")/]+)/.exec(permission)?.[1];
    if (team && !server.circles.has(team)) {
      throw Object.assign(new Error("Permissions must be one of (any, users, user:u1...)"), { code: 401 });
    }
  }
}

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    client: { subscribe: () => () => {} },
    account: {
      get: async () => {
        if (!server.online) unreachable();
        return { ...server.user, prefs: { ...server.prefs } };
      },
      getPrefs: async () => ({ ...server.prefs }),
      updatePrefs: async ({ prefs }: { prefs: Record<string, unknown> }) => {
        server.prefWrites += 1;
        // Appwrite's own words: "stored as is, and replaces any previous value".
        server.prefs = { ...prefs };
        return { ...server.user, prefs: server.prefs };
      },
      createJWT: async () => ({ jwt: "jwt" }),
    },
    tables: {
      getRow: async ({ tableId, rowId }: { tableId: string; rowId: string }) => {
        if (server.flakyReads > 0) {
          server.flakyReads -= 1;
          unreachable();
        }
        const row = table(tableId).get(rowId);
        if (!row) throw Object.assign(new Error("Row not found"), { code: 404 });
        return row;
      },
      listRows: async ({ tableId, queries = [] }: { tableId: string; queries?: string[] }) => {
        if (!server.online) unreachable();
        const rows = [...table(tableId).values()].filter((row) => matches(row, queries));
        return { total: rows.length, rows };
      },
      createRow: async (p: { tableId: string; rowId: string; data: Record<string, unknown>; permissions?: string[] }) => {
        refuseForeignTeams(p.permissions);
        if (table(p.tableId).has(p.rowId)) throw Object.assign(new Error("Row already exists"), { code: 409 });
        const row: Row = { ...p.data, $id: p.rowId, $permissions: p.permissions ?? [] };
        table(p.tableId).set(p.rowId, row);
        return row;
      },
      updateRow: async (p: { tableId: string; rowId: string; data?: Record<string, unknown>; permissions?: string[] }) => {
        refuseForeignTeams(p.permissions);
        const row = table(p.tableId).get(p.rowId);
        if (!row) throw Object.assign(new Error("Row not found"), { code: 404 });
        const next = { ...row, ...p.data, $permissions: p.permissions ?? row.$permissions };
        table(p.tableId).set(p.rowId, next);
        return next;
      },
      deleteRow: async () => ({}),
    },
    storage: {},
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  forgetCircle();
  forgetProfile();
  forgetUser();
  server.online = true;
  server.user = { $id: "u1", name: "Ruairi", email: "ruairi@example.com" };
  // Somebody else's pref, already on the account. It must survive.
  server.prefs = { theme: "dark" };
  server.tables = new Map();
  server.circles = new Set();
  server.prefWrites = 0;
  server.flakyReads = 0;
  // /api/circle is this app's own route; it makes the caller's circle team.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/circle") {
        server.circles.add(`circle_${server.user.$id}`);
        return new Response(JSON.stringify({ teamId: `circle_${server.user.$id}` }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function landsOn(): Promise<string> {
  replace.mockClear();
  render(
    <SessionProvider>
      <Landing />
    </SessionProvider>,
  );
  await waitFor(() => expect(replace).toHaveBeenCalled());
  const to = replace.mock.calls[0][0] as string;
  cleanup();
  return to;
}

it("asks a brand-new coach once, makes their profile, and remembers the side they last used", async () => {
  expect(await landsOn()).toBe("/welcome");

  render(
    <SessionProvider>
      <WelcomeScreen />
    </SessionProvider>,
  );
  const name = await screen.findByLabelText("Your name");
  // Pre-filled from the account, the same fallback the profile uses.
  expect(name).toHaveValue("Ruairi");
  await userEvent.click(screen.getByRole("radio", { name: /Coach/ }));
  await userEvent.clear(name);
  await userEvent.type(name, "Ruairi Deane");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  // The photo is offered after everything that matters is saved, and skipping
  // it loses nothing.
  await userEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/coach/roster"));
  cleanup();

  // The profile exists from minute one, under the typed name, stamped so that
  // the provenance check every coach-side reader runs accepts it.
  const profile = table("profiles").get("u1");
  expect(profile).toMatchObject({ user_id: "u1", display_name: "Ruairi Deane" });
  expect(profile?.$permissions).toContain('update("user:u1")');
  expect(profile?.$permissions).toContain('read("team:circle_u1")');
  // The mode was merged into prefs, not written over them.
  expect(server.prefs).toEqual({ theme: "dark", snb_mode: "coach", snb_chose_coach: true });

  // Next sign-in: no question, straight to the roster.
  expect(await landsOn()).toBe("/coach/roster");

  // They look at the athlete side. The athlete layout records it...
  render(
    <SessionProvider>
      <AthleteProviders>
        <p>Today</p>
      </AthleteProviders>
    </SessionProvider>,
  );
  await waitFor(() => expect(server.prefs.snb_mode).toBe("athlete"));
  cleanup();
  // ...without losing their way back to coach mode, or the other pref.
  expect(server.prefs).toEqual({ theme: "dark", snb_mode: "athlete", snb_chose_coach: true });

  // ...and that is where the next sign-in opens.
  expect(await landsOn()).toBe("/today");
});

it("does not write the mode again when the side has not changed", async () => {
  server.prefs = { snb_mode: "athlete" };
  render(
    <SessionProvider>
      <AthleteProviders>
        <p>Today</p>
      </AthleteProviders>
    </SessionProvider>,
  );
  await screen.findByText("Today");
  // Let any effect that was going to write do so.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(server.prefWrites).toBe(0);
});

it("keeps a name somebody already chose when the field was left as it was", async () => {
  // A profile written on the Me screen before they ever saw this page.
  server.circles.add("circle_u1");
  table("profiles").set("u1", {
    $id: "u1",
    $permissions: ['read("user:u1")', 'read("team:circle_u1")', 'update("user:u1")', 'delete("user:u1")'],
    user_id: "u1",
    display_name: "Coach Ruairi",
  });
  render(
    <SessionProvider>
      <WelcomeScreen />
    </SessionProvider>,
  );
  // The field moves to the stored name once the read lands.
  await waitFor(() => expect(screen.getByLabelText("Your name")).toHaveValue("Coach Ruairi"));
  await userEvent.click(screen.getByRole("radio", { name: /Athlete/ }));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await userEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/today"));
  expect(table("profiles").get("u1")?.display_name).toBe("Coach Ruairi");
});

it("keeps that name even when the screen could not read it and guessed from the account", async () => {
  server.circles.add("circle_u1");
  table("profiles").set("u1", {
    $id: "u1",
    $permissions: ['read("user:u1")', 'read("team:circle_u1")', 'update("user:u1")', 'delete("user:u1")'],
    user_id: "u1",
    display_name: "Coach Ruairi",
  });
  // The screen's own read fails; the field keeps the account-name guess. The
  // write path reads again and finds the real name, which an untouched guess
  // must not overwrite.
  server.flakyReads = 1;
  render(
    <SessionProvider>
      <WelcomeScreen />
    </SessionProvider>,
  );
  expect(await screen.findByLabelText("Your name")).toHaveValue("Ruairi");
  await userEvent.click(screen.getByRole("radio", { name: /Athlete/ }));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await userEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/today"));
  expect(table("profiles").get("u1")?.display_name).toBe("Coach Ruairi");
});

it("saves no mode when the profile could not be written, so the question is asked again", async () => {
  // The circle route is down: the profile write would carry a team role the
  // user is not in, and Appwrite refuses it.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
  render(
    <SessionProvider>
      <WelcomeScreen />
    </SessionProvider>,
  );
  await userEvent.click(await screen.findByRole("radio", { name: /Athlete/ }));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t save that");
  expect(server.prefs).toEqual({ theme: "dark" });
  expect(replace).not.toHaveBeenCalledWith("/today");
});

it("sends a coach from before the question to the roster, and saves that for them", async () => {
  table("coach_athlete_links").set("l1", {
    $id: "l1",
    $permissions: [],
    coach_id: "u1",
    athlete_id: "a1",
    status: "active",
  });
  expect(await landsOn()).toBe("/coach/roster");
  await waitFor(() => expect(server.prefs.snb_mode).toBe("coach"));
  expect(server.prefs.theme).toBe("dark");
});

it("opens an offline cold start on the side used last, from the device's memory", async () => {
  server.prefs = { snb_mode: "coach", snb_chose_coach: true };
  expect(await landsOn()).toBe("/coach/roster");

  // No signal, but somebody is remembered on this device.
  server.online = false;
  server.prefs = {};
  expect(await landsOn()).toBe("/coach/roster");
});

it("does not strand a never-asked user offline on a form that cannot submit", async () => {
  // Signed in once before modes existed: the remembered record has no prefs.
  localStorage.setItem(
    "snb.last-user",
    JSON.stringify({ user: { id: "u1", name: "Ruairi", email: "" }, coach: { isCoach: false, athleteIds: [] } }),
  );
  server.online = false;
  expect(await landsOn()).toBe("/today");
});

it("filters by the query helpers the real code sends", () => {
  // Guards the fake itself: if `Query.equal` changes shape, the link lookup in
  // these tests would silently match everything.
  const q = Query.equal("coach_id", "u1");
  expect(matches({ $id: "x", $permissions: [], coach_id: "u2" }, [q])).toBe(false);
  expect(matches({ $id: "x", $permissions: [], coach_id: "u1" }, [q])).toBe(true);
});
