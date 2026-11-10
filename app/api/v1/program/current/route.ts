import { currentProgram } from "@/lib/api/v1/program";
import { readEndpoint } from "@/lib/api/v1/serve";

/** GET /api/v1/program/current: the published block, as My Program shows it. docs/read-api.md */

export const runtime = "nodejs";

const endpoint = readEndpoint(currentProgram);
export const GET = endpoint.GET;
export const POST = endpoint.POST;
export const PUT = endpoint.PUT;
export const PATCH = endpoint.PATCH;
export const DELETE = endpoint.DELETE;
