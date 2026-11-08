import { Account, Client } from "node-appwrite";
import { serverAppwriteConfig } from "@/appwrite/env";

/** Whoever the JWT says, or null. Never an id from a body. */
export async function callerFrom(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return null;
  const config = serverAppwriteConfig();
  try {
    const asCaller = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setJWT(jwt);
    return (await new Account(asCaller).get()).$id;
  } catch {
    return null;
  }
}
