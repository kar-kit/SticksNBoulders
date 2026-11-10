import { DEFAULT_UNITS, fallbackName } from "@/lib/profile/profile";
import { ok, ownProfile, type ApiResult, type ReadContext } from "./context";

/**
 * GET /api/v1/me: who the token belongs to, their units, and when the token
 * stops working. The cheap call that proves a token works.
 *
 * The display name is the profile's, falling back the way the app does when
 * there is no profile yet: the account name, then the email's local part.
 */
export async function me(ctx: ReadContext): Promise<ApiResult> {
  const profile = await ownProfile(ctx);
  let displayName = profile?.displayName.trim() ?? "";
  if (!displayName) {
    const account = await ctx.account().catch(() => ({ name: "", email: "" }));
    displayName = fallbackName(account.name, account.email);
  }
  return ok({
    id: ctx.ownerId,
    displayName,
    units: profile?.units ?? DEFAULT_UNITS,
    token: { id: ctx.token.id, label: ctx.token.label, expiresAt: ctx.token.expiresAt },
  });
}
