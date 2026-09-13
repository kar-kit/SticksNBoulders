import { Query, Users } from "node-appwrite";
import { NextResponse } from "next/server";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { looksLikeEmail, normaliseEmail, resolveMethodHint, type UserDirectory } from "@/lib/auth/method-hint";

/**
 * Tells the sign-in screen whether an address belongs to an account created
 * through Google or Apple rather than with a password.
 *
 * It exists because Appwrite returns one indistinguishable error for a wrong
 * password, an unknown email and a provider-only account -- so without this,
 * an athlete who signed up with Google gets "that email and password don't
 * match" and then a reset email for an account with no password to reset.
 *
 * It is also an enumeration oracle, so it is deliberately stingy: it answers
 * only for accounts that HAVE no password, and it is rate-limited per address
 * and per caller. It never confirms that an address is unknown, and never
 * confirms one that has a password set.
 *
 * The limiter is in-memory, which holds for one self-hosted instance -- the
 * whole beta. Running more than one instance needs shared state.
 */

export const runtime = "nodejs";

const byIp = createRateLimiter({ limit: 10, windowMs: 60_000 });
const byEmail = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 });

/** Says nothing, in the same shape as a real answer. */
const SILENT = { hint: "none" } as const;

function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function directory(): UserDirectory {
  const users = new Users(createServerClient(serverAppwriteConfig()));
  return {
    async findByEmail(email) {
      const found = await users.list({ queries: [Query.equal("email", email), Query.limit(1)] });
      const user = found.users[0];
      if (!user) return null;
      // Appwrite exposes the password hash on the admin user object. Its
      // presence is what separates a password account from a provider one.
      return { id: user.$id, hasPassword: Boolean(user.password) };
    },
    async providersFor(userId) {
      try {
        const identities = await users.listIdentities({
          queries: [Query.equal("userId", userId), Query.limit(10)],
        });
        return identities.identities.map((identity) => identity.provider);
      } catch {
        // An unreadable identity list is not a reason to fail the request; the
        // caller falls back to a provider-agnostic nudge.
        return [];
      }
    },
  };
}

export async function POST(request: Request) {
  let email: string;
  try {
    const body = (await request.json()) as { email?: unknown };
    email = normaliseEmail(typeof body.email === "string" ? body.email : "");
  } catch {
    return NextResponse.json(SILENT);
  }

  // Rejected before any rate-limit budget is spent, so garbage cannot lock a
  // real caller out.
  if (!looksLikeEmail(email)) return NextResponse.json(SILENT);

  const ip = byIp.check(callerKey(request));
  if (!ip.allowed) {
    return NextResponse.json(SILENT, {
      status: 429,
      headers: { "Retry-After": String(ip.retryAfterSeconds) },
    });
  }

  const address = byEmail.check(email);
  if (!address.allowed) {
    return NextResponse.json(SILENT, {
      status: 429,
      headers: { "Retry-After": String(address.retryAfterSeconds) },
    });
  }

  try {
    const hint = await resolveMethodHint(directory(), email);
    return NextResponse.json(hint, {
      // Never cached: the answer is about one person and changes the moment
      // they set a password.
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // Staying silent to the caller is right -- an error here must not become a
    // signal about the address. But swallowing it entirely once turned a
    // missing APPWRITE_API_KEY into "no hint", which looks exactly like
    // working correctly. It gets logged server-side instead.
    console.error("[method-hint] lookup failed", error);
    return NextResponse.json(SILENT);
  }
}
