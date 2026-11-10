import { getSession } from "@/lib/api/v1/sessions";
import { serve } from "@/lib/api/v1/serve";

/**
 * GET /api/v1/sessions/:id: one of the owner's sessions with its sets.
 * Another athlete's id, or none, is 404. docs/read-api.md
 */

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return serve(request, (ctx) => getSession(ctx, id));
}

const refuse = (request: Request) => serve(request, null);
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
