import { Account, Client, TablesDB, Users } from "node-appwrite";
import type { ServerAppwriteConfig } from "@/appwrite/env";

/**
 * The read API's view of the database: the token owner's own, and nothing
 * more (F29).
 *
 * After a token checks out, the route mints a short-lived JWT for its owner
 * with the API key and does every data read through a client built on that
 * JWT alone -- no key. Appwrite's row permissions then decide what comes
 * back, exactly as they do in the app, so a bug in a query can narrow what
 * the owner sees but never widen it past what they could read signed in.
 *
 * The API key does two things here and only two: mint the JWT, and (in
 * api-token-admin.ts) touch the token and audit tables. It never reads a row
 * of training data.
 *
 * Lives in appwrite/documents because it constructs a TablesDB, which the
 * write-helper guard allows only here (guard.test.ts). This one only reads.
 */

/**
 * How long a minted JWT lives, in seconds. One request needs it for a few
 * hundred milliseconds; a minute covers a slow instance with room to spare,
 * and a JWT that leaked from a log would be dead before anyone found it.
 * Appwrite's default is 900 and its maximum 3600.
 */
export const OWNER_JWT_SECONDS = 60;

/** A JWT for the token's owner. The key mints it; it carries only the owner's own rights. */
export async function mintOwnerJwt(admin: Client, ownerId: string): Promise<string> {
  return (await new Users(admin).createJWT({ userId: ownerId, duration: OWNER_JWT_SECONDS })).jwt;
}

export interface OwnerReader {
  listRows(params: {
    databaseId: string;
    tableId: string;
    queries?: string[];
    total?: boolean;
    ttl?: number;
  }): Promise<{ rows: Array<{ $id: string } & Record<string, unknown>> }>;
  getRow(params: { databaseId: string; tableId: string; rowId: string }): Promise<{ $id: string } & Record<string, unknown>>;
}

export interface OwnerView {
  tables: OwnerReader;
  /** The owner's account name and email, read as the owner. For the display name fallback. */
  account(): Promise<{ name: string; email: string }>;
}

/** Reads as the JWT's user. No API key, by construction: there is nowhere to put one. */
export function ownerView(config: Pick<ServerAppwriteConfig, "endpoint" | "projectId">, jwt: string): OwnerView {
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setJWT(jwt);
  const db = new TablesDB(client);
  return {
    tables: {
      listRows: (params) => db.listRows(params) as unknown as ReturnType<OwnerReader["listRows"]>,
      getRow: (params) => db.getRow(params) as unknown as ReturnType<OwnerReader["getRow"]>,
    },
    account: async () => {
      const me = await new Account(client).get();
      return { name: me.name ?? "", email: me.email ?? "" };
    },
  };
}
