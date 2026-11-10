import { me } from "@/lib/api/v1/me";
import { readEndpoint } from "@/lib/api/v1/serve";

/** GET /api/v1/me: who the token is for, their units, and the token's expiry. docs/read-api.md */

export const runtime = "nodejs";

const endpoint = readEndpoint(me);
export const GET = endpoint.GET;
export const POST = endpoint.POST;
export const PUT = endpoint.PUT;
export const PATCH = endpoint.PATCH;
export const DELETE = endpoint.DELETE;
