import { NextResponse } from "next/server";
import { revokeToken } from "@/appwrite/documents/api-token-admin";
import { gate, NO_STORE } from "../gate";

/**
 * DELETE /api/tokens/:id (F29): revoke one of the caller's tokens, for good.
 * Somebody else's id, or one that does not exist, is 404 either way.
 */

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const access = await gate(request);
  if (!access.ok) return access.response;
  const { id } = await context.params;
  try {
    const result = await revokeToken(access.ctx, id);
    if (result.status === "absent") return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error("[api-tokens] revoke failed", error);
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
