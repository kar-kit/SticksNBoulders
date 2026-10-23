import { circleTeamId } from "./circle";
import { exercisePermissions, sessionPermissions } from "./policy";
import type { RowWriter } from "./row-writer";
import {
  createCoachLink,
  createExercise,
  createGlobalExercise,
  createInviteCode,
  createProfile,
  createSession,
  createSet,
  deleteExercise,
  deleteSession,
  deleteSet,
  EXERCISE_IN_USE,
  finishSession,
  normaliseSessionName,
  renameExercise,
  SESSION_HAS_SETS,
  updateSession,
  SET_HAS_COACH_COMMENTS,
  normaliseExerciseName,
  revokeCoachLink,
  setGlobalExerciseVideoDefault,
  setLinkSuggestionMode,
  updateSet,
  writeRollup,
  type WriteDeps,
} from "./write";

const ATHLETE = "athlete_joey";
const COACH = "coach_ruairi";
const NOW = new Date("2026-10-14T18:42:00.000Z");

interface Captured {
  op: "create" | "update" | "delete";
  tableId: string;
  rowId: string;
  data: Record<string, unknown>;
  permissions?: string[];
}

function harness() {
  const calls: Captured[] = [];
  let counter = 0;

  const writer: RowWriter = {
    async createRow({ tableId, rowId, data, permissions }) {
      calls.push({ op: "create", tableId, rowId, data, permissions });
      return { $id: rowId, ...data };
    },
    async updateRow({ tableId, rowId, data, permissions }) {
      calls.push({ op: "update", tableId, rowId, data: data ?? {}, permissions });
      return { $id: rowId };
    },
    async deleteRow({ tableId, rowId }) {
      calls.push({ op: "delete", tableId, rowId, data: {} });
      return {};
    },
  };

  const deps: WriteDeps = {
    writer,
    databaseId: "sticksnboulders",
    newId: () => `generated_${++counter}`,
    now: () => NOW,
  };

  return { deps, calls, actor: { userId: ATHLETE }, last: () => calls[calls.length - 1] };
}

describe("every write stamps permissions", () => {
  it.each([
    ["profiles", async (h: ReturnType<typeof harness>) => createProfile(h.deps, h.actor, { displayName: "Joey" })],
    ["exercises", async (h: ReturnType<typeof harness>) => createExercise(h.deps, h.actor, { name: "Barbell Row" })],
    ["sessions", async (h: ReturnType<typeof harness>) => createSession(h.deps, h.actor, { clientSessionId: "c1" })],
    [
      "sets",
      async (h: ReturnType<typeof harness>) =>
        createSet(h.deps, h.actor, {
          sessionId: "s1",
          exerciseId: "e1",
          setIndex: 1,
          loadKg: 142.5,
          reps: 5,
          clientSetId: "cs1",
        }),
    ],
  ])("%s is never written without permissions", async (tableId, run) => {
    const h = harness();
    await run(h);
    const call = h.last();
    expect(call.tableId).toBe(tableId);
    expect(call.permissions, `${tableId} written with no permissions`).toBeDefined();
    expect(call.permissions!.length).toBeGreaterThan(0);
  });

  it("re-stamps on update, so a row does not keep a stale policy", async () => {
    const h = harness();
    await updateSet(h.deps, h.actor, { rowId: "row1", loadKg: 145, reps: 5, rpe: 8, isWarmup: false });
    expect(h.last().permissions).toContain(`read("team:${circleTeamId(ATHLETE)}")`);
  });

  it("grants read to the athlete's circle and write to the athlete alone", async () => {
    const h = harness();
    await createSet(h.deps, h.actor, {
      sessionId: "s1", exerciseId: "e1", setIndex: 1, loadKg: 180, reps: 3, clientSetId: "cs2",
    });
    expect(h.last().permissions).toEqual([
      `read("user:${ATHLETE}")`,
      `read("team:${circleTeamId(ATHLETE)}")`,
      `update("user:${ATHLETE}")`,
      `delete("user:${ATHLETE}")`,
    ]);
  });
});

describe("denormalisation happens here and only here", () => {
  it("stamps athlete_id onto a set from the actor, never the caller", async () => {
    const h = harness();
    // The caller cannot supply athlete_id: a set belongs to whoever logged it.
    await createSet(h.deps, h.actor, {
      sessionId: "s1", exerciseId: "e1", setIndex: 2, loadKg: 100, reps: 5, clientSetId: "cs3",
    });
    expect(h.last().data.athlete_id).toBe(ATHLETE);
  });

  it("keeps athlete_id and the permission stamp consistent by construction", async () => {
    // If these two ever disagree, a coach sees somebody else's training. They
    // are written in one place so they cannot.
    const h = harness();
    await createSet(h.deps, h.actor, {
      sessionId: "s1", exerciseId: "e1", setIndex: 3, loadKg: 100, reps: 5, clientSetId: "cs4",
    });
    const call = h.last();
    expect(call.permissions).toContain(`read("team:${circleTeamId(String(call.data.athlete_id))}")`);
  });

  it("stamps athlete_id onto a session too", async () => {
    const h = harness();
    await createSession(h.deps, h.actor, { clientSessionId: "c2" });
    expect(h.last().data.athlete_id).toBe(ATHLETE);
  });
});

describe("offline safety", () => {
  it("requires a client id on a set, because a retry must not duplicate it", async () => {
    const h = harness();
    await expect(
      createSet(h.deps, h.actor, {
        sessionId: "s1", exerciseId: "e1", setIndex: 1, loadKg: 100, reps: 5, clientSetId: "",
      }),
    ).rejects.toThrow(/clientSetId is required/);
  });

  it("requires a client id on a session", async () => {
    const h = harness();
    await expect(createSession(h.deps, h.actor, { clientSessionId: "" })).rejects.toThrow(
      /clientSessionId is required/,
    );
  });

  it("keeps the time the set was actually logged, not the time it synced", async () => {
    // A set logged in the gym at 18:42 and synced at 20:10 is an 18:42 set.
    const h = harness();
    const loggedAt = new Date("2026-10-14T18:42:00.000Z");
    await createSet(h.deps, h.actor, {
      sessionId: "s1", exerciseId: "e1", setIndex: 1, loadKg: 100, reps: 5, clientSetId: "cs5", loggedAt,
    });
    expect(h.last().data.logged_at).toBe(loggedAt.toISOString());
  });

  it("falls back to now when no logged time is given", async () => {
    const h = harness();
    await createSet(h.deps, h.actor, {
      sessionId: "s1", exerciseId: "e1", setIndex: 1, loadKg: 100, reps: 5, clientSetId: "cs6",
    });
    expect(h.last().data.logged_at).toBe(NOW.toISOString());
  });

  it("refuses a set with no session or exercise rather than orphaning it", async () => {
    const h = harness();
    const base = { setIndex: 1, loadKg: 100, reps: 5, clientSetId: "cs7" };
    await expect(createSet(h.deps, h.actor, { ...base, sessionId: "", exerciseId: "e1" })).rejects.toThrow(
      /sessionId is required/,
    );
    await expect(createSet(h.deps, h.actor, { ...base, sessionId: "s1", exerciseId: "" })).rejects.toThrow(
      /exerciseId is required/,
    );
  });
});

describe("set data", () => {
  it("defaults is_warmup to false rather than leaving it unset", async () => {
    const h = harness();
    await createSet(h.deps, h.actor, {
      sessionId: "s1", exerciseId: "e1", setIndex: 1, loadKg: 100, reps: 5, clientSetId: "cs8",
    });
    expect(h.last().data.is_warmup).toBe(false);
  });

  it("writes a null RPE as absent, because 'not sure' is not a number", async () => {
    const h = harness();
    await createSet(h.deps, h.actor, {
      sessionId: "s1", exerciseId: "e1", setIndex: 1, loadKg: 100, reps: 5, clientSetId: "cs9", rpe: null,
    });
    expect(h.last().data.rpe).toBeUndefined();
  });

  it("clears an RPE back to null on update when asked", async () => {
    const h = harness();
    await updateSet(h.deps, h.actor, { rowId: "r1", loadKg: 140, reps: 5, rpe: null, isWarmup: false });
    expect(h.last().data.rpe).toBeNull();
  });

  it("writes the athlete's note trimmed and capped, clears a blank one, and leaves it alone when absent (F11)", async () => {
    const h = harness();
    const base = { rowId: "r1", loadKg: 140, reps: 5, rpe: 8, isWarmup: false };
    await updateSet(h.deps, h.actor, { ...base, notes: "  Hip pinched  " });
    expect(h.last().data.notes).toBe("Hip pinched");
    await updateSet(h.deps, h.actor, { ...base, notes: "x".repeat(600) });
    expect(h.last().data.notes).toHaveLength(500);
    await updateSet(h.deps, h.actor, { ...base, notes: "  " });
    expect(h.last().data.notes).toBeNull();
    await updateSet(h.deps, h.actor, { ...base, notes: null });
    expect(h.last().data.notes).toBeNull();
    await updateSet(h.deps, h.actor, base);
    expect("notes" in h.last().data).toBe(false);
    // Still the athlete's own stamp: a note is theirs to write and nobody else's.
    expect(h.last().permissions).toContain(`update("user:${ATHLETE}")`);
  });

  it("recomputes e1RM from the corrected values", async () => {
    // The gap Order 11 left open. An edit that changes reps and leaves the old
    // estimate on the row is the drift computing it in the helper prevents.
    const h = harness();
    await updateSet(h.deps, h.actor, { rowId: "r1", loadKg: 140, reps: 5, rpe: 8, isWarmup: false });
    expect(h.last().data.e1rm_kg).toBe(168);
  });

  it("clears the estimate when an edit removes the grounds for one", async () => {
    // Null, not undefined: undefined leaves the stale number in place, which is
    // the whole failure being fixed.
    const h = harness();
    await updateSet(h.deps, h.actor, { rowId: "r1", loadKg: 140, reps: 5, rpe: 8, isWarmup: true });
    expect(h.last().data.e1rm_kg).toBeNull();

    await updateSet(h.deps, h.actor, { rowId: "r1", loadKg: 140, reps: 5, rpe: null, isWarmup: false });
    expect(h.last().data.e1rm_kg).toBeNull();
  });
});

describe("exercise names", () => {
  it.each([
    ["Barbell Row", "barbell row"],
    ["barbell  row", "barbell row"],
    ["  Barbell Row  ", "barbell row"],
    ["Barbell-Row", "barbell row"],
    ["Böhler Press", "bohler press"],
    ["Bench Press (Close Grip)", "bench press close grip"],
  ])("normalises %j to %j so duplicates collide", (input, expected) => {
    expect(normaliseExerciseName(input)).toBe(expected);
  });

  it("stores the athlete's spelling alongside the normalised form", async () => {
    const h = harness();
    await createExercise(h.deps, h.actor, { name: "  Barbell Row  " });
    expect(h.last().data).toMatchObject({ name: "Barbell Row", normalised_name: "barbell row" });
  });

  it("never creates a global exercise from the logger", async () => {
    // Promoting into the shared library is a deliberate, separate act.
    const h = harness();
    await createExercise(h.deps, h.actor, { name: "Belt Squat" });
    expect(h.last().data.is_global).toBe(false);
    expect(h.last().permissions).not.toContain('read("users")');
  });

  it("refuses a blank name", async () => {
    const h = harness();
    await expect(createExercise(h.deps, h.actor, { name: "   " })).rejects.toThrow(/name is required/);
  });

  it("never sets a video default on an exercise typed during a session", async () => {
    const h = harness();
    await createExercise(h.deps, h.actor, { name: "Belt Squat" });
    expect(h.last().data).not.toHaveProperty("video_default");
  });
});

describe("a library exercise's video default", () => {
  it("is written only when true, so a row without one is the row it was before", async () => {
    const h = harness();
    await createGlobalExercise(h.deps, { name: "Squat", videoDefault: true });
    expect(h.last().data).toMatchObject({ is_global: true, video_default: true });
    await createGlobalExercise(h.deps, { name: "Leg Curl" });
    expect(h.last().data).not.toHaveProperty("video_default");
    await createGlobalExercise(h.deps, { name: "Leg Press", videoDefault: false });
    expect(h.last().data).not.toHaveProperty("video_default");
  });

  it("is set on an existing row as that one field, keeping the library's stamp", async () => {
    const h = harness();
    await setGlobalExerciseVideoDefault(h.deps, { rowId: "ex-squat", videoDefault: true });
    expect(h.last()).toMatchObject({ op: "update", tableId: "exercises", rowId: "ex-squat", data: { video_default: true } });
    expect(h.last().permissions).toContain('read("users")');
    await setGlobalExerciseVideoDefault(h.deps, { rowId: "ex-squat", videoDefault: false });
    expect(h.last().data).toEqual({ video_default: false });
  });
});

describe("profiles", () => {
  it("uses the user id as the row id, so a lookup needs no query", async () => {
    const h = harness();
    await createProfile(h.deps, h.actor, { displayName: "Joey Pang" });
    expect(h.last().rowId).toBe(ATHLETE);
  });

  it("defaults units to kg", async () => {
    const h = harness();
    await createProfile(h.deps, h.actor, { displayName: "Joey Pang" });
    expect(h.last().data.units).toBe("kg");
  });
});

describe("sessions", () => {
  it("stores totals on finish rather than summing them on read", async () => {
    const h = harness();
    await finishSession(h.deps, h.actor, { sessionId: "s1", setCount: 12, tonnageKg: 6100 });
    expect(h.last().data).toMatchObject({ set_count: 12, tonnage_kg: 6100 });
    expect(h.last().data.finished_at).toBe(NOW.toISOString());
  });

  it("starts a session with zeroed totals and no finish time", async () => {
    const h = harness();
    await createSession(h.deps, h.actor, { clientSessionId: "c3" });
    expect(h.last().data).toMatchObject({ set_count: 0, tonnage_kg: 0 });
    expect(h.last().data.finished_at).toBeUndefined();
  });
});

describe("server-only writes", () => {
  it("stamps a rollup as readable but writable by nobody", async () => {
    const h = harness();
    await writeRollup(h.deps, {
      athleteId: ATHLETE, exerciseId: "e1", weekStart: new Date("2026-10-12T00:00:00.000Z"),
      setCount: 12, volumeReps: 60, tonnageKg: 6100,
    });
    expect(h.last().permissions).toEqual([
      `read("user:${ATHLETE}")`,
      `read("team:${circleTeamId(ATHLETE)}")`,
    ]);
  });

  it("updates an existing rollup in place when given a row id", async () => {
    const h = harness();
    await writeRollup(h.deps, {
      athleteId: ATHLETE, exerciseId: "e1", weekStart: new Date("2026-10-12T00:00:00.000Z"),
      setCount: 1, volumeReps: 5, tonnageKg: 700, rowId: "existing",
    });
    expect(h.last().op).toBe("update");
    expect(h.last().rowId).toBe("existing");
  });

  it("links a coach to an athlete as active, readable by both", async () => {
    const h = harness();
    await createCoachLink(h.deps, { coachId: COACH, athleteId: ATHLETE });
    expect(h.last().data).toMatchObject({ coach_id: COACH, athlete_id: ATHLETE, status: "active" });
    expect(h.last().permissions).toEqual([`read("user:${ATHLETE}")`, `read("user:${COACH}")`]);
  });

  it("refuses to link someone to themselves", async () => {
    const h = harness();
    await expect(createCoachLink(h.deps, { coachId: ATHLETE, athleteId: ATHLETE })).rejects.toThrow(
      /cannot be linked to themselves/,
    );
  });

  it("writes an invite code at the code's own id, readable by the coach alone", async () => {
    // The row id IS the code, which is what makes Order 16's lookup a point
    // read -- and what makes a 409 here mean "taken", not "already done".
    const h = harness();
    await createInviteCode(h.deps, { code: "SNB-4F7K2", coachId: COACH });
    expect(h.last().tableId).toBe("invite_codes");
    expect(h.last().rowId).toBe("SNB-4F7K2");
    expect(h.last().data).toMatchObject({ coach_id: COACH, created_at: NOW.toISOString() });
    expect(h.last().permissions).toEqual([`read("user:${COACH}")`]);
  });

  it("revokes rather than deletes, so losing access stays auditable", async () => {
    const h = harness();
    await revokeCoachLink(h.deps, { rowId: "link1", coachId: COACH, athleteId: ATHLETE });
    expect(h.last().op).toBe("update");
    expect(h.last().data).toMatchObject({ status: "revoked", revoked_at: NOW.toISOString() });
  });
});

describe("the coach's suggestion switch", () => {
  it("writes the one column, and never the status or dates the permission model trusts", async () => {
    const h = harness();
    await setLinkSuggestionMode(h.deps, { rowId: "link1", coachId: COACH, athleteId: ATHLETE, mode: "held" });
    expect(h.last()).toMatchObject({ op: "update", tableId: "coach_athlete_links", rowId: "link1" });
    expect(h.last().data).toEqual({ suggestions_mode: "held" });
  });

  it("re-stamps read for the two parties and write for nobody", async () => {
    const h = harness();
    await setLinkSuggestionMode(h.deps, { rowId: "link1", coachId: COACH, athleteId: ATHLETE, mode: "direct" });
    expect(h.last().permissions).toEqual([`read("user:${ATHLETE}")`, `read("user:${COACH}")`]);
  });

  it("refuses a mode it does not know rather than storing it", async () => {
    const h = harness();
    await expect(
      setLinkSuggestionMode(h.deps, {
        rowId: "link1",
        coachId: COACH,
        athleteId: ATHLETE,
        mode: "approve" as never,
      }),
    ).rejects.toThrow(/unknown mode/);
    expect(h.calls).toEqual([]);
  });
});

describe("deleting a set", () => {
  it("deletes when nobody else has commented", async () => {
    const { deps, actor, calls } = harness();
    await deleteSet(deps, actor, "st-1", { othersCommented: async () => false });
    expect(calls).toEqual([{ op: "delete", tableId: "sets", rowId: "st-1", data: {} }]);
  });

  it("refuses, and writes nothing, once a coach has commented", async () => {
    // The coach's words are their record, the athlete cannot delete them, and
    // a thread about a set that no longer exists is a correction about nothing.
    const { deps, actor, calls } = harness();
    const attempt = deleteSet(deps, actor, "st-1", { othersCommented: async () => true });
    await expect(attempt).rejects.toMatchObject({ message: SET_HAS_COACH_COMMENTS, code: 412 });
    expect(calls).toEqual([]);
  });

  it("uses a status the queue files as permanent, not as already done", async () => {
    const { classify } = await import("@/lib/offline/queue");
    const { deps, actor } = harness();
    const error = await deleteSet(deps, actor, "st-1", { othersCommented: async () => true }).catch((e) => e);
    expect(classify(error)).toBe("permanent");
  });
});

describe("rollups clear what no longer exists", () => {
  it("writes null rather than undefined for an empty best, so an update clears it", async () => {
    const { deps, last } = harness();
    await writeRollup(deps, {
      athleteId: ATHLETE,
      exerciseId: "squat",
      weekStart: new Date("2026-10-12T00:00:00.000Z"),
      setCount: 1,
      volumeReps: 5,
      tonnageKg: 700,
      bestE1rmKg: null,
      rowId: "rollup-1",
    });
    expect(last().op).toBe("update");
    expect(last().data.best_e1rm_kg).toBeNull();
  });
});

describe("editing a session from History", () => {
  it("names it, stamped for its athlete like every session write", async () => {
    const h = harness();
    await updateSession(h.deps, h.actor, { sessionId: "cs-1", name: "  Heavy   singles " });
    expect(h.last()).toEqual({
      op: "update",
      tableId: "sessions",
      rowId: "cs-1",
      data: { name: "Heavy singles" },
      permissions: sessionPermissions({ athleteId: ATHLETE }),
    });
  });

  it("clears a blank name with null, so the old one does not survive", async () => {
    const h = harness();
    await updateSession(h.deps, h.actor, { sessionId: "cs-1", name: "   ", notes: "" });
    expect(h.last().data).toEqual({ name: null, notes: null });
  });

  it("touches only what it is given", async () => {
    // A totals refresh after a set edit must not wipe the name, and a rename
    // must not wipe the totals.
    const h = harness();
    await updateSession(h.deps, h.actor, { sessionId: "cs-1", totals: { setCount: 7, tonnageKg: 3150.5 } });
    expect(h.last().data).toEqual({ set_count: 7, tonnage_kg: 3150.5 });
    await updateSession(h.deps, h.actor, { sessionId: "cs-1", notes: "Felt fast" });
    expect(h.last().data).toEqual({ notes: "Felt fast" });
  });

  it("never moves the session or reassigns it", async () => {
    const h = harness();
    await updateSession(h.deps, h.actor, { sessionId: "cs-1", name: "x", notes: "y", totals: { setCount: 1, tonnageKg: 1 } });
    for (const key of ["started_at", "athlete_id", "program_day_id", "finished_at"]) {
      expect(h.last().data).not.toHaveProperty(key);
    }
  });

  it("caps a name to the column rather than refusing it", () => {
    expect(normaliseSessionName("a".repeat(200))).toHaveLength(80);
    expect(normaliseSessionName(null)).toBeNull();
  });

  it("refuses negative totals", async () => {
    const h = harness();
    await expect(
      updateSession(h.deps, h.actor, { sessionId: "cs-1", totals: { setCount: -1, tonnageKg: 0 } }),
    ).rejects.toThrow("non-negative");
    expect(h.calls).toEqual([]);
  });
});

describe("deleting a session", () => {
  it("deletes once no set names it", async () => {
    const { deps, actor, calls } = harness();
    await deleteSession(deps, actor, "cs-1", { setsRemain: async () => false });
    expect(calls).toEqual([{ op: "delete", tableId: "sessions", rowId: "cs-1", data: {} }]);
  });

  it("refuses, permanently, while sets remain -- the ones a coach commented on", async () => {
    const { classify } = await import("@/lib/offline/queue");
    const { deps, actor, calls } = harness();
    const error = await deleteSession(deps, actor, "cs-1", { setsRemain: async () => true }).catch((e) => e);
    expect(error).toMatchObject({ message: SESSION_HAS_SETS, code: 412 });
    expect(classify(error)).toBe("permanent");
    expect(calls).toEqual([]);
  });
});

describe("the athlete's own exercises", () => {
  it("renames one, with the normalised name following and the owner's stamp", async () => {
    const h = harness();
    await renameExercise(h.deps, h.actor, { rowId: "ex-1", name: " Romanian  Deadlift " });
    expect(h.last()).toEqual({
      op: "update",
      tableId: "exercises",
      rowId: "ex-1",
      data: { name: "Romanian Deadlift", normalised_name: "romanian deadlift" },
      permissions: exercisePermissions({ athleteId: ATHLETE, isGlobal: false }),
    });
  });

  it("will not rename to nothing", async () => {
    const h = harness();
    await expect(renameExercise(h.deps, h.actor, { rowId: "ex-1", name: "  " })).rejects.toThrow("name is required");
  });

  it("deletes an unused one", async () => {
    const { deps, actor, calls } = harness();
    await deleteExercise(deps, actor, "ex-1", { inUse: async () => false });
    expect(calls).toEqual([{ op: "delete", tableId: "exercises", rowId: "ex-1", data: {} }]);
  });

  it("refuses to orphan sets, maxes or program lines", async () => {
    const { classify } = await import("@/lib/offline/queue");
    const { deps, actor, calls } = harness();
    const error = await deleteExercise(deps, actor, "ex-1", { inUse: async () => true }).catch((e) => e);
    expect(error).toMatchObject({ message: EXERCISE_IN_USE, code: 412 });
    expect(classify(error)).toBe("permanent");
    expect(calls).toEqual([]);
  });
});
