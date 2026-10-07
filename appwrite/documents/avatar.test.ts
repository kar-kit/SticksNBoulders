import { avatarOf, isOwnAvatarFileId, newAvatarFileId } from "./avatar";
import { circleTeamId } from "./circle";
import { avatarPermissions } from "./policy";
import { verdictFor } from "./provenance";
import type { RowWriter } from "./row-writer";
import { setProfileAvatar } from "./write";

const JOEY = "68e4a1c2003b5f7d9e10";
const SAM = "68e4a1c2003b5f7d9e11";

describe("a picture's id names its owner", () => {
  it("is the user id, an underscore and eight letters or digits", () => {
    const id = newAvatarFileId(JOEY, () => 0.5);
    expect(id).toMatch(new RegExp(`^${JOEY}_[a-z0-9]{8}$`));
    expect(id.length).toBeLessThanOrEqual(36);
  });

  it("is new every time, so replacing never has to delete before uploading", () => {
    expect(newAvatarFileId(JOEY)).not.toBe(newAvatarFileId(JOEY));
  });

  it("refuses a user id that leaves no room inside Appwrite's 36 characters", () => {
    expect(() => newAvatarFileId("u".repeat(28))).toThrow(/36-character/);
    expect(() => newAvatarFileId("u".repeat(27))).not.toThrow();
  });

  it.each([
    ["the owner's own", `${JOEY}_abc12345`, true],
    ["somebody else's", `${SAM}_abc12345`, false],
    ["the bare user id", JOEY, false],
    ["a suffix that is too short", `${JOEY}_abc1234`, false],
    ["a suffix carrying another underscore", `${JOEY}_ab_12345`, false],
    ["uppercase, which the app never generates", `${JOEY}_ABC12345`, false],
    ["a number", 42, false],
    ["null", null, false],
  ])("accepts %s: %s -> %s", (_label, fileId, expected) => {
    expect(isOwnAvatarFileId(JOEY, fileId)).toBe(expected);
  });

  it("cannot be claimed by a user whose id is a prefix of the owner's", () => {
    // User "ab" must not own "ab_cdefghij_..." style ids belonging to "ab_cdefghij".
    const longer = "ab_cdefghij";
    const theirs = `${longer}_abc12345`;
    expect(isOwnAvatarFileId(longer, theirs)).toBe(true);
    expect(isOwnAvatarFileId("ab", theirs)).toBe(false);
  });
});

describe("what a reader shows", () => {
  it("shows the owner's own picture", () => {
    expect(avatarOf({ user_id: JOEY, avatar_file_id: `${JOEY}_abc12345` })).toBe(`${JOEY}_abc12345`);
  });

  it("shows initials when a profile points at somebody else's picture", () => {
    // Joey and Sam share a coach. Joey pointing his profile at Sam's file
    // would put Sam's face beside Joey's name in that coach's rail.
    expect(avatarOf({ user_id: JOEY, avatar_file_id: `${SAM}_abc12345` })).toBeNull();
  });

  it("shows initials for a profile with no picture, however the absence is spelled", () => {
    for (const value of [undefined, null, "", "   "]) {
      expect(avatarOf({ user_id: JOEY, avatar_file_id: value })).toBeNull();
    }
  });
});

describe("who can see a picture", () => {
  const permissions = avatarPermissions({ userId: JOEY });

  it("is the owner and their circle -- a linked coach -- and nobody wider", () => {
    expect(permissions).toContain(`read("user:${JOEY}")`);
    expect(permissions).toContain(`read("team:${circleTeamId(JOEY)}")`);
    const joined = permissions.join(" ");
    // The stamp a stranger would use; the audit treats it as squattable.
    expect(joined).not.toContain('"users"');
    expect(joined).not.toContain('"any"');
  });

  it("is changed or removed by the owner alone, never by the circle", () => {
    expect(permissions.filter((p) => p.startsWith("update(") || p.startsWith("delete("))).toEqual([
      `update("user:${JOEY}")`,
      `delete("user:${JOEY}")`,
    ]);
  });
});

describe("pointing a profile at a picture", () => {
  function writer() {
    const updates: Array<{ rowId: string; data?: Record<string, unknown>; permissions?: string[] }> = [];
    const fake: RowWriter = {
      createRow: async () => ({ $id: "x" }),
      updateRow: async (params) => {
        updates.push(params);
        return { $id: params.rowId };
      },
      deleteRow: async () => ({}),
    };
    return { updates, deps: { writer: fake, databaseId: "db", newId: () => "id", now: () => new Date() } };
  }

  it("writes the id onto the owner's own row, re-stamped by the profile policy", async () => {
    const { updates, deps } = writer();
    await setProfileAvatar(deps, { userId: JOEY }, { fileId: `${JOEY}_abc12345` });
    expect(updates).toHaveLength(1);
    expect(updates[0].rowId).toBe(JOEY);
    expect(updates[0].data).toEqual({ avatar_file_id: `${JOEY}_abc12345` });
    expect(updates[0].permissions).toContain(`update("user:${JOEY}")`);
  });

  it("clears with null, so the old id cannot survive the removal", async () => {
    const { updates, deps } = writer();
    await setProfileAvatar(deps, { userId: JOEY }, { fileId: null });
    expect(updates[0].data).toEqual({ avatar_file_id: null });
  });

  it("refuses to point at somebody else's picture, and writes nothing", async () => {
    const { updates, deps } = writer();
    await expect(setProfileAvatar(deps, { userId: JOEY }, { fileId: `${SAM}_abc12345` })).rejects.toThrow();
    expect(updates).toEqual([]);
  });
});

describe("the validator and a borrowed picture", () => {
  const row = (avatar: string) => ({
    $id: JOEY,
    $tableId: "profiles",
    user_id: JOEY,
    display_name: "Joey",
    avatar_file_id: avatar,
    $permissions: [`read("user:${JOEY}")`, `update("user:${JOEY}")`, `delete("user:${JOEY}")`],
  });

  it("keeps the profile -- its owner wrote it -- and says why the picture is ignored", () => {
    // Deleting an honest profile over a cosmetic field would cost the athlete
    // their name, sex and units. Readers already show initials instead.
    const verdict = verdictFor("profiles", row(`${SAM}_abc12345`));
    expect(verdict.action).toBe("keep");
    expect(verdict.reason).toMatch(/avatar_file_id is not theirs/);
  });

  it("says nothing special about a profile with its own picture", () => {
    expect(verdictFor("profiles", row(`${JOEY}_abc12345`))).toEqual({ action: "keep", reason: "stamped by its owner" });
  });

  it("still deletes a squat carrying a picture, as it deletes any squat", () => {
    const squat = { ...row(`${JOEY}_abc12345`), $permissions: ['read("users")'] };
    expect(verdictFor("profiles", squat).action).toBe("delete");
  });
});
