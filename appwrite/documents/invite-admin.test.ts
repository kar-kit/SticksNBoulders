import { ensureInviteCode, type InviteTables } from "./invite-admin";

const DB = "sticksnboulders";

const conflict = () => Object.assign(new Error("already exists"), { code: 409 });

/** A stand-in for the table, remembering row ids the way Appwrite would. */
function fakeTables(seed: Array<{ $id: string; coach_id: string }> = []) {
  const rows = [...seed];
  const created: Array<{ rowId: string; data: Record<string, unknown>; permissions?: string[] }> = [];
  const tables: InviteTables = {
    listRows: async ({ queries }) => {
      const wanted = queries.find((q) => q.includes("coach_id"))!;
      return { rows: rows.filter((r) => wanted.includes(r.coach_id)) as never };
    },
    writer: {
      createRow: async (params) => {
        if (rows.some((r) => r.$id === params.rowId)) throw conflict();
        const coachId = String(params.data.coach_id);
        // The unique index on coach_id, which Appwrite reports the same way.
        if (rows.some((r) => r.coach_id === coachId)) throw conflict();
        rows.push({ $id: params.rowId, coach_id: coachId });
        created.push({ rowId: params.rowId, data: params.data, permissions: params.permissions });
        return {} as never;
      },
      updateRow: async () => ({}) as never,
      deleteRow: async () => ({}) as never,
    },
  };
  return { tables, rows, created };
}

describe("a coach's invite code", () => {
  it("mints one and stamps it readable by that coach alone", async () => {
    const { tables, created } = fakeTables();
    const result = await ensureInviteCode(tables, DB, "ruairi", () => "SNB-4F7K2");

    expect(result).toEqual({ code: "SNB-4F7K2", created: true });
    // The code IS the row id. Order 16 reads it back without a query.
    expect(created[0].rowId).toBe("SNB-4F7K2");
    expect(created[0].data.coach_id).toBe("ruairi");
    expect(created[0].permissions).toEqual(['read("user:ruairi")']);
  });

  it("hands back the same code on a second call, rather than a second code", async () => {
    // A coach who taps twice, or whose first request timed out on gym wifi,
    // must not end up with the code they already texted somebody going stale.
    const { tables } = fakeTables();
    const first = await ensureInviteCode(tables, DB, "ruairi", () => "SNB-4F7K2");
    const second = await ensureInviteCode(tables, DB, "ruairi", () => "SNB-ZZZZZ");

    expect(second).toEqual({ code: first.code, created: false });
  });

  it("generates another when the first is already somebody else's", async () => {
    const { tables } = fakeTables([{ $id: "SNB-4F7K2", coach_id: "louis" }]);
    const codes = ["SNB-4F7K2", "SNB-8HJQ3"];
    const result = await ensureInviteCode(tables, DB, "ruairi", () => codes.shift()!);

    expect(result).toEqual({ code: "SNB-8HJQ3", created: true });
  });

  it("yields to a racing request rather than failing the coach", async () => {
    // Two tabs, one coach. The unique index refuses the second write; the code
    // the winner minted is the real one and this call returns it.
    const { tables, rows } = fakeTables();
    const result = await ensureInviteCode(tables, DB, "ruairi", () => {
      // Stands in for the other request landing between the lookup and the
      // write: the row appears after we have already decided to create one.
      if (rows.length === 0) rows.push({ $id: "SNB-W2NAA", coach_id: "ruairi" });
      return "SNB-K7T4B";
    });

    expect(result).toEqual({ code: "SNB-W2NAA", created: false });
  });

  it("gives up loudly rather than looping when nothing is free", async () => {
    const { tables } = fakeTables([{ $id: "SNB-4F7K2", coach_id: "louis" }]);
    await expect(ensureInviteCode(tables, DB, "ruairi", () => "SNB-4F7K2")).rejects.toThrow(
      /no free code/,
    );
  });

  it("refuses to mint a code for nobody", async () => {
    const { tables } = fakeTables();
    await expect(ensureInviteCode(tables, DB, "")).rejects.toThrow(/coachId is required/);
  });

  it("re-raises anything that is not a conflict", async () => {
    const { tables } = fakeTables();
    tables.writer.createRow = async () => {
      throw Object.assign(new Error("offline"), { code: 503 });
    };
    await expect(ensureInviteCode(tables, DB, "ruairi", () => "SNB-4F7K2")).rejects.toThrow("offline");
  });
});
