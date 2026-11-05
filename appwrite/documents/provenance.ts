import { avatarOf } from "./avatar";
import { isReactionEmoji, REACTION_EMOJIS } from "./reaction";
import {
  LIBRARY_TEAM_ID,
  POLICIES,
  SERVER_ONLY_TABLES,
  USER_WRITABLE_TABLES,
  writtenByServer,
  writtenByUser,
} from "./policy";

/**
 * Who really wrote a row.
 *
 * Appwrite polices who may READ a row, not what the row CLAIMS. Every table
 * with a table-level `create("users")` accepts a row from any session carrying
 * somebody else's `athlete_id`, `owner_id`, `coach_id` or `author_id`, stamped
 * `read("users")` -- a role every session holds -- and every read in the app
 * filters on those columns. So the victim and their coach read a stranger's
 * row as theirs (docs/permission-audit.md, "Finding, 27 Sep 2026").
 *
 * What a session cannot do is stamp a role it does not hold. `user:<id>` is
 * held by exactly one account, and `team:library` by nobody at all. So the
 * stored permissions carry a proof of authorship the data columns do not:
 *
 *   - a set carrying `update("user:<athlete_id>")` was written by that athlete
 *   - a comment carrying `update("user:<author_id>")` was written by its author,
 *     and so was a reaction (F25)
 *   - a review carrying `update("user:<coach_id>")` was written by that coach
 *   - a library exercise carrying `update("team:library")` was written by the
 *     server, because no session can stamp a team it is not in
 *
 * This file is that check, in one place. Every store reads through
 * `authenticRows` / `isAuthentic`, the rollup rebuild filters sets through it,
 * and the validate-row Function deletes whatever fails it. Three consumers,
 * one definition: a check scattered across stores is a check one store will
 * eventually skip.
 *
 * Pure. No client, no network.
 */

export type Row = Record<string, unknown>;

const str = (row: Row, key: string) => (typeof row[key] === "string" ? (row[key] as string) : "");

const permissionsOf = (row: Row): string[] => {
  const raw = row.$permissions;
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
};

/**
 * The permissions policy.ts would stamp on this row today, or null when the
 * row does not carry the fields needed to say.
 *
 * The "rescan documents for missing or wrong permissions" half of the audit
 * (Build Plan section 7). Rows are frozen at write time, so a policy change or
 * a write path that skipped the helper leaves rows behind that no
 * session-based test will ever touch.
 */
export function expectedStamp(tableId: string, row: Row): string[] | null {
  try {
    switch (tableId) {
      case "profiles":
        return POLICIES.profiles({ athleteId: str(row, "user_id") });
      case "exercises":
        return row.is_global === true
          ? POLICIES.exercises({ athleteId: "library", isGlobal: true })
          : POLICIES.exercises({ athleteId: str(row, "owner_id"), isGlobal: false });
      case "sessions":
      case "sets":
      case "bodyweight_entries":
      case "stats_rollups":
      case "reference_maxes":
        return POLICIES[tableId]({ athleteId: str(row, "athlete_id") });
      case "set_reviews":
        return POLICIES.set_reviews({ athleteId: str(row, "athlete_id"), coachId: str(row, "coach_id") });
      case "set_comments":
        return POLICIES.set_comments({ athleteId: str(row, "athlete_id"), authorId: str(row, "author_id") });
      case "comment_reactions":
        return POLICIES.comment_reactions({ athleteId: str(row, "athlete_id"), authorId: str(row, "author_id") });
      case "coach_athlete_links":
        return POLICIES.coach_athlete_links({ coachId: str(row, "coach_id"), athleteId: str(row, "athlete_id") });
      case "invite_codes":
        return POLICIES.invite_codes({ coachId: str(row, "coach_id") });
      case "push_subscriptions":
        return POLICIES.push_subscriptions({ userId: str(row, "user_id") });
      case "programs":
      case "program_blocks":
      case "program_weeks":
      case "program_days":
      case "prescriptions":
        // A template has no athlete; the column is null and the policy gets null.
        return POLICIES[tableId]({ coachId: str(row, "coach_id"), athleteId: str(row, "athlete_id") || null });
      default:
        return null;
    }
  } catch {
    // The policy refuses an empty id. A row missing its owner is drift too,
    // and the caller reports it as such.
    return null;
  }
}

/**
 * The permissions that prove the row's owner fields are telling the truth, or
 * null when the row does not say who it belongs to.
 *
 * Spelled out per table rather than derived from the policy's update entries,
 * so a future policy that grants some other role an update -- a coach, say --
 * cannot silently become "proof" that a coach wrote an athlete's set. A test
 * pins each proof to being a subset of what the policy stamps, which is the
 * property that makes it a proof at all.
 *
 * Server-only tables have no proof and need none: no session may create a row
 * in them, so a row's existence is the proof.
 */
export function ownerProof(tableId: string, row: Row): string[] | null {
  try {
    switch (tableId) {
      case "profiles":
        return [writtenByUser(str(row, "user_id"))];
      case "exercises":
        return row.is_global === true ? [writtenByServer()] : [writtenByUser(str(row, "owner_id"))];
      case "sessions":
      case "sets":
      case "bodyweight_entries":
        return [writtenByUser(str(row, "athlete_id"))];
      case "set_reviews":
        return [writtenByUser(str(row, "coach_id"))];
      case "set_comments":
      case "comment_reactions":
        return [writtenByUser(str(row, "author_id"))];
      default:
        return (SERVER_ONLY_TABLES as readonly string[]).includes(tableId) ? [] : null;
    }
  } catch {
    return null;
  }
}

/**
 * Whether the row was written by whoever its owner fields say.
 *
 * False for a row the check does not understand -- an unknown table, a row
 * with no owner. Readers drop what they cannot vouch for.
 *
 * A profile also has to sit at its own user's id. The id is how the app finds
 * it, so a row at somebody else's id is a squat on their profile however it
 * is stamped.
 */
export function isAuthentic(tableId: string, row: Row): boolean {
  const proof = ownerProof(tableId, row);
  if (proof === null) return false;
  if (tableId === "profiles" && str(row, "$id") !== str(row, "user_id")) return false;
  const have = new Set(permissionsOf(row));
  return proof.every((p) => have.has(p));
}

/** The rows a reader may trust. Order preserved. */
export function authenticRows<T extends Row>(tableId: string, rows: readonly T[]): T[] {
  return rows.filter((row) => isAuthentic(tableId, row));
}

/**
 * What is wrong with a row's CONTENT that no stamp can police, or null.
 *
 * Authorship is the stamp's job; this is for the rare column whose allowed
 * values are a product decision rather than a type. Today that is one: a
 * reaction's emoji, which Joey fixed at six (reaction.ts). The column is a
 * string, so Appwrite takes anything up to its size, and a session that skips
 * the write helper can store "🍆" stamped perfectly by its own author.
 *
 * Deliberately narrow. This is not a general validation layer: a value
 * outside a fixed set is the only content judgement here, because it is the
 * only one cheap to state exactly and impossible to get wrong for an honest
 * row -- the helper refuses the same values before they are sent.
 */
export function contentProblem(tableId: string, row: Row): string | null {
  if (tableId === "comment_reactions" && !isReactionEmoji(row.emoji)) {
    return `emoji ${JSON.stringify(row.emoji ?? null)} is not one of ${REACTION_EMOJIS.join(" ")}`;
  }
  return null;
}

/* -------------------------------------------------------------------------
 * The validator's verdict
 * ---------------------------------------------------------------------- */

/**
 * Tables the validate-row Function acts on: the ones a session can write.
 *
 * Deliberately not every table. The Function deletes rows, and a bug in it
 * must be able to reach only rows a stranger could have written. A
 * server-only table has no such rows, so the Function never touches one.
 */
export const VALIDATED_TABLES: readonly string[] = USER_WRITABLE_TABLES;

export type Verdict =
  | { action: "keep"; reason: string }
  | { action: "delete"; reason: string }
  | { action: "skip"; reason: string };

/**
 * What the validate-row Function should do with a row it was told about.
 *
 * Pure, so the Function body is a dozen lines of transport and this is what
 * gets tested. `delete` only when the row names an owner and lacks that
 * owner's proof -- never on a row the check does not understand, and never
 * for a mismatch in some other permission. A row written before a policy
 * change carries a stale read stamp and the correct proof; the stamp scan
 * reports it and the validator leaves it alone. "Destroy only what could not
 * have been written by its owner" is the scope that keeps a bug here from
 * being a mass delete.
 *
 * The one addition (F25): a row its owner did write, carrying a value
 * `contentProblem` rules out -- a reaction outside the six. Joey asked for
 * those refused in the validator as well as at the write boundary, and an
 * honest write never produces one, so the scope argument still holds: the
 * only rows this can reach were written around the helper.
 */
export function verdictFor(tableId: string, row: Row): Verdict {
  if (!VALIDATED_TABLES.includes(tableId)) {
    return { action: "skip", reason: `${tableId} is not a table a session can write` };
  }
  const proof = ownerProof(tableId, row);
  if (proof === null) {
    return { action: "skip", reason: "the row names no owner to check against" };
  }
  if (tableId === "profiles" && str(row, "$id") !== str(row, "user_id")) {
    return { action: "delete", reason: `profile at ${str(row, "$id")} claims to be ${str(row, "user_id")}'s` };
  }
  const have = new Set(permissionsOf(row));
  const missing = proof.filter((p) => !have.has(p));
  if (missing.length === 0) {
    // Its owner wrote it, so it stays: deleting somebody's profile over the
    // picture they pointed it at would destroy an honest name, sex and units
    // to remove a cosmetic field. Every reader goes through `avatarOf`, which
    // shows initials instead. Said in the log so the oddity is visible.
    if (tableId === "profiles" && hasForeignAvatar(row)) {
      return { action: "keep", reason: "stamped by its user; avatar_file_id is not theirs and is ignored by readers" };
    }
    const problem = contentProblem(tableId, row);
    if (problem) return { action: "delete", reason: `stamped by its ${ownerLabel(tableId)}, but ${problem}` };
    return { action: "keep", reason: "stamped by its owner" };
  }
  return {
    action: "delete",
    reason: `missing ${missing.join(", ")}: not written by the ${ownerLabel(tableId)} it names`,
  };
}

/* -------------------------------------------------------------------------
 * The validator's cascade
 * ---------------------------------------------------------------------- */

/** Rows that go when another row is deleted: these, in this table. */
export interface Cascade {
  tableId: string;
  column: string;
  value: string;
}

/**
 * What a deleted row takes with it, or null for nothing.
 *
 * One rule today: a comment takes its reactions (F25). It cannot be done from
 * the browser. The reactions on a comment were written by the OTHER party --
 * nobody may react to their own message -- and stamped delete for that party
 * alone, so the comment's author, withdrawing it, holds no right to remove
 * them, and no session can stamp one for somebody else (policy.ts,
 * `reactionPermissions`). The Function's key can.
 *
 * Pure and this narrow on purpose, like `verdictFor`: the Function acts on
 * the deleted row's own id and on one column of one table, so the most a bug
 * here can reach is the reactions on a comment that is already gone -- and
 * readers never show those anyway (lib/review/reactions.ts drops a reaction
 * whose comment it cannot see). The cascade is a tidy-up, not a defence.
 */
export function cascadeFor(tableId: string, row: Row): Cascade | null {
  const id = str(row, "$id");
  if (!id) return null;
  if (tableId === "set_comments") return { tableId: "comment_reactions", column: "comment_id", value: id };
  return null;
}

function hasForeignAvatar(row: Row): boolean {
  const raw = row.avatar_file_id;
  return typeof raw === "string" && raw !== "" && avatarOf(row) === null;
}

function ownerLabel(tableId: string): string {
  switch (tableId) {
    case "set_reviews":
      return "coach";
    case "set_comments":
    case "comment_reactions":
      return "author";
    case "exercises":
      return "owner";
    case "profiles":
      return "user";
    default:
      return "athlete";
  }
}

export { LIBRARY_TEAM_ID };
