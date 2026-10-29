import { describe, expect, it } from "vitest";
import { schema } from "../appwrite/schema";
import {
  isFixtureEmail,
  isFixtureUser,
  mayDeleteRow,
  permissionsOwnedByFixtures,
  personColumnsOf,
  rowOwnedByFixtures,
} from "./e2e-fixture-scope";

const stamp = 1760000000000;
const created = new Date(stamp + 1500).toISOString();

describe("isFixtureEmail", () => {
  it.each([
    `myprog-a-${stamp}@example.com`,
    `e2e-${stamp}@example.com`,
    `audit-unlinkedcoach-${stamp}@example.com`,
    `flood-3-${stamp}@example.com`,
    `e2e-dots-c-${stamp}@sticksnboulders.test`,
  ])("accepts what the e2e scripts write: %s", (email) => {
    expect(isFixtureEmail(email)).toBe(true);
  });

  it.each([
    "joey@example.com", // reserved domain, but no stamp: a person could type it
    `joey.pang-${stamp}@example.com`, // a dot is not in any script's tag
    `Myprog-a-${stamp}@example.com`, // scripts write lowercase
    `myprog-a-${stamp}@example.com.evil.io`,
    `myprog-a-${stamp}@sub.example.com`,
    `myprog-a-${stamp}@gmail.com`,
    `myprog-a-${stamp}@sticksnboulders.com`,
    `myprog-a-123@example.com`, // not a ms stamp
    `myprog-a-${stamp}@EXAMPLE.COM`,
    ` myprog-a-${stamp}@example.com`,
    "",
  ])("refuses anything else: %s", (email) => {
    expect(isFixtureEmail(email)).toBe(false);
  });
});

describe("isFixtureUser", () => {
  it("needs the account to have been created when its address says", () => {
    expect(isFixtureUser({ email: `lift-${stamp}@example.com`, $createdAt: created })).toBe(true);
    const yearLater = new Date(stamp + 365 * 24 * 60 * 60_000).toISOString();
    expect(isFixtureUser({ email: `lift-${stamp}@example.com`, $createdAt: yearLater })).toBe(false);
    expect(isFixtureUser({ email: `lift-${stamp}@example.com` })).toBe(false);
  });

  it("is never a real address, however recent", () => {
    expect(isFixtureUser({ email: "joey@gmail.com", $createdAt: created })).toBe(false);
  });
});

describe("person columns", () => {
  it("covers every table in the schema, so prune can reach all of them", () => {
    const uncovered = schema.tables.filter((t) => personColumnsOf(t).length === 0).map((t) => t.id);
    expect(uncovered).toEqual([]);
    expect(schema.tables.length).toBe(16);
    expect(schema.buckets.map((b) => b.id).sort()).toEqual(["avatars", "set_video_posters", "set_video_proxies", "set_videos"]);
  });
});

describe("rowOwnedByFixtures", () => {
  const fixtures = new Set(["fixA", "fixC"]);
  const cols = ["coach_id", "athlete_id"];

  it("takes a row only when every person on it is a fixture", () => {
    expect(rowOwnedByFixtures({ coach_id: "fixC", athlete_id: "fixA" }, cols, fixtures).ok).toBe(true);
    expect(rowOwnedByFixtures({ coach_id: "fixC", athlete_id: null }, cols, fixtures).ok).toBe(true);
  });

  it("leaves a row that also names a real account", () => {
    expect(rowOwnedByFixtures({ coach_id: "fixC", athlete_id: "joey" }, cols, fixtures).ok).toBe(false);
  });

  it("leaves a row naming nobody, and any global row", () => {
    expect(rowOwnedByFixtures({ coach_id: null, athlete_id: "" }, cols, fixtures).ok).toBe(false);
    expect(rowOwnedByFixtures({ owner_id: "fixA", is_global: true }, ["owner_id"], fixtures).ok).toBe(false);
  });
});

describe("permissionsOwnedByFixtures", () => {
  const fixtures = new Set(["fixA", "fixC"]);

  it("accepts the fixture, its circle in any role, and the generic roles", () => {
    const perms = [
      'read("user:fixA")',
      'update("user:fixA")',
      'read("team:circle_fixA")',
      'read("team:circle_fixC/coach")',
      'read("users")',
      'read("any")',
    ];
    expect(permissionsOwnedByFixtures(perms, fixtures).ok).toBe(true);
  });

  it("refuses a row a real account or team can reach", () => {
    expect(permissionsOwnedByFixtures(['read("user:joey")'], fixtures).ok).toBe(false);
    expect(permissionsOwnedByFixtures(['read("team:circle_joey")'], fixtures).ok).toBe(false);
    expect(permissionsOwnedByFixtures(['read("team:fixA")'], fixtures).ok).toBe(false); // not a circle id
    expect(permissionsOwnedByFixtures(['read("member:abc")'], fixtures).ok).toBe(false);
    expect(permissionsOwnedByFixtures(['read("label:admin")'], fixtures).ok).toBe(false);
    expect(permissionsOwnedByFixtures(["garbage"], fixtures).ok).toBe(false);
  });

  it("needs both locks for a delete", () => {
    const row = { athlete_id: "fixA", $permissions: ['read("user:fixA")', 'read("team:circle_joey")'] };
    expect(mayDeleteRow(row, ["athlete_id"], fixtures).ok).toBe(false);
  });
});
