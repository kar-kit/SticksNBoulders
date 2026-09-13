import { z } from "zod";

/**
 * Appwrite configuration, validated at the boundary.
 *
 * The endpoint is an env var from the first commit so the self-hosted to Cloud
 * migration in January 2027 is a config change rather than a code change.
 */
/**
 * z.url() alone is not enough: new URL("localhost:80") parses happily, with
 * "localhost:" as the protocol. A typo like that would sail through startup
 * and fail at the first request instead, so the protocol is checked here.
 */
const httpUrl = z.url().refine(
  (value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  },
  { message: "must be an http(s) URL" },
);

const publicSchema = z.object({
  endpoint: httpUrl,
  projectId: z.string().min(1),
  databaseId: z.string().min(1),
});

const serverSchema = publicSchema.extend({
  // Server-only. Never prefixed NEXT_PUBLIC_, never sent to a browser.
  apiKey: z.string().min(1),
});

export type PublicAppwriteConfig = z.infer<typeof publicSchema>;
export type ServerAppwriteConfig = z.infer<typeof serverSchema>;

function read(source: Record<string, string | undefined>) {
  return {
    endpoint: source.NEXT_PUBLIC_APPWRITE_ENDPOINT,
    projectId: source.NEXT_PUBLIC_APPWRITE_PROJECT_ID,
    databaseId: source.NEXT_PUBLIC_APPWRITE_DATABASE_ID,
    apiKey: source.APPWRITE_API_KEY,
  };
}

function explain(error: z.ZodError, context: string): never {
  const missing = error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `${context}: Appwrite config is invalid or missing (${missing}). ` +
      `Copy .env.example to .env.local and fill it in.`,
  );
}

export function publicAppwriteConfig(
  source: Record<string, string | undefined> = process.env,
): PublicAppwriteConfig {
  const parsed = publicSchema.safeParse(read(source));
  if (!parsed.success) explain(parsed.error, "Client");
  return parsed.data;
}

export function serverAppwriteConfig(
  source: Record<string, string | undefined> = process.env,
): ServerAppwriteConfig {
  const parsed = serverSchema.safeParse(read(source));
  if (!parsed.success) explain(parsed.error, "Server");
  return parsed.data;
}
