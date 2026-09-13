import { Client } from "node-appwrite";
import { serverAppwriteConfig, type ServerAppwriteConfig } from "./env";

/**
 * An admin client. It carries an API key and bypasses every permission, so it
 * belongs to setup scripts and Appwrite Functions only -- never to a route
 * handler that runs on behalf of a signed-in user.
 */
export function createServerClient(config: ServerAppwriteConfig = serverAppwriteConfig()): Client {
  return new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId)
    .setKey(config.apiKey);
}
