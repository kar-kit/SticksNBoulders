import { ExecutionMethod } from "appwrite";
import { functions } from "./appwrite";

/** Calls an Appwrite Function synchronously and unwraps its JSON response, throwing on error. */
export async function callFunction<T>(functionId: string, body: object): Promise<T> {
  const execution = await functions.createExecution(
    functionId,
    JSON.stringify(body),
    false,
    "/",
    ExecutionMethod.POST
  );

  let parsed: (T & { error?: string }) | undefined;
  try {
    parsed = JSON.parse(execution.responseBody);
  } catch {
    // fall through to the generic error below
  }

  if (execution.responseStatusCode >= 400 || !parsed) {
    throw new Error(parsed?.error ?? "Request failed");
  }
  return parsed;
}
