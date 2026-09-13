"use client";

import { Account, Client } from "appwrite";
import { publicAppwriteConfig } from "./env";

/**
 * The browser client. Carries the signed-in athlete's session and nothing
 * else -- no API key ever reaches this file, and the guard test checks that.
 */
let cached: { client: Client; account: Account } | null = null;

export function browserAppwrite() {
  if (cached) return cached;
  const config = publicAppwriteConfig({
    NEXT_PUBLIC_APPWRITE_ENDPOINT: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
    NEXT_PUBLIC_APPWRITE_PROJECT_ID: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID,
    NEXT_PUBLIC_APPWRITE_DATABASE_ID: process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID,
  });
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId);
  cached = { client, account: new Account(client) };
  return cached;
}
