"use client";

import { Account, Client, Storage, TablesDB } from "appwrite";
import { publicAppwriteConfig } from "./env";

/**
 * The browser client. Carries the signed-in athlete's session and nothing
 * else -- no API key ever reaches this file, and the guard test checks that.
 */
let cached: {
  client: Client;
  account: Account;
  tables: TablesDB;
  storage: Storage;
  databaseId: string;
} | null = null;

export function browserAppwrite() {
  if (cached) return cached;
  const config = publicAppwriteConfig({
    NEXT_PUBLIC_APPWRITE_ENDPOINT: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
    NEXT_PUBLIC_APPWRITE_PROJECT_ID: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID,
    NEXT_PUBLIC_APPWRITE_DATABASE_ID: process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID,
  });
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId);
  // TablesDB here is for READS only. Every write goes through
  // appwrite/documents, enforced by a lint rule and a guard test.
  cached = {
    client,
    account: new Account(client),
    tables: new TablesDB(client),
    // Storage is the one place a browser write is legitimate: a video is a
    // file, not a row, so it does not pass through appwrite/documents. The
    // row that records its id still does.
    storage: new Storage(client),
    databaseId: config.databaseId,
  };
  return cached;
}
