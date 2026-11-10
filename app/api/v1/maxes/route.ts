import { maxes } from "@/lib/api/v1/maxes";
import { readEndpoint } from "@/lib/api/v1/serve";

/** GET /api/v1/maxes: training, tested and best e1RM per lift. docs/read-api.md */

export const runtime = "nodejs";

const endpoint = readEndpoint(maxes);
export const GET = endpoint.GET;
export const POST = endpoint.POST;
export const PUT = endpoint.PUT;
export const PATCH = endpoint.PATCH;
export const DELETE = endpoint.DELETE;
