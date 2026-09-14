"use client";

import { browserAppwrite } from "../browser-client";
import type { RowWriter } from "./row-writer";

/**
 * The browser's row writer.
 *
 * The first write path the athlete app has: everything before this was reads
 * and scripts. It lives here, inside appwrite/documents, because this is the
 * only directory allowed to touch Appwrite's row mutators -- a component that
 * wanted to write would have to come through the helper to reach it, which is
 * exactly the property the permission model rests on.
 *
 * It carries the signed-in athlete's session, so Appwrite applies their
 * permissions to every write. It is not an admin client and must never become
 * one; `browser-client.ts` has no API key and the guard test checks that.
 *
 * Deliberately thin. It moves rows to Appwrite and decides nothing: which
 * permissions to stamp and which fields to denormalise belong to write.ts, one
 * file over, where they are reviewed together.
 */
export function browserRowWriter(): RowWriter {
  const { tables } = browserAppwrite();
  return {
    createRow: (params) => tables.createRow(params),
    updateRow: (params) => tables.updateRow(params),
    deleteRow: (params) => tables.deleteRow(params),
  };
}

/** The database the browser writes to, alongside the writer that writes to it. */
export function browserWriteDeps(newId: () => string, now: () => Date = () => new Date()) {
  const { databaseId } = browserAppwrite();
  return { writer: browserRowWriter(), databaseId, newId, now };
}
