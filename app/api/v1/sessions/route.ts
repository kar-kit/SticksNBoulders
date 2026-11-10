import { listSessions, SESSIONS_PARAMS } from "@/lib/api/v1/sessions";
import { readEndpoint } from "@/lib/api/v1/serve";

/** GET /api/v1/sessions?from=&to=&limit=&cursor=: History, newest first. docs/read-api.md */

export const runtime = "nodejs";

const endpoint = readEndpoint(listSessions, SESSIONS_PARAMS);
export const GET = endpoint.GET;
export const POST = endpoint.POST;
export const PUT = endpoint.PUT;
export const PATCH = endpoint.PATCH;
export const DELETE = endpoint.DELETE;
