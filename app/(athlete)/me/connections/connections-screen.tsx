"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/input";
import { useArrivals } from "@/components/ui/motion";
import { useSession } from "@/lib/auth/session-context";
import {
  DEFAULT_EXPIRY_CHOICE,
  EXPIRY_CHOICES,
  datesLine,
  lastUsedLine,
  liveCount,
  orderTokens,
  stateLabel,
  type TokenSummary,
} from "@/lib/api/connections";
import { API_TOKEN_LABEL_MAX } from "@/appwrite/documents/api-token";
import { fetchTokenAccess, mintToken, revokeToken, type MintedToken } from "@/lib/api/token-store";

/**
 * Me, Connections (F29): personal access tokens for the read-only API, so a
 * script or an assistant can read this athlete's sessions, program and maxes
 * without their password.
 *
 * Only for user ids on API_TOKEN_USER_IDS. The server says who: anyone else
 * gets 403 from /api/tokens, and this screen sends them back to Me.
 *
 * A new token is shown once, here, with a copy button, and is gone from the
 * screen the moment it is dismissed or the page is left. Nothing stores it:
 * not this component beyond its own state, not the server, not the cache.
 */

const COPIED_MS = 2000;

type Load = { status: "loading" } | { status: "ready"; tokens: TokenSummary[]; maxLive: number } | { status: "failed" };

export function ConnectionsScreen() {
  const router = useRouter();
  const { state: session } = useSession();
  const userId = session.status === "signed-in" ? session.user.id : null;

  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number>(DEFAULT_EXPIRY_CHOICE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const access = await fetchTokenAccess();
      if (!access.allowed) {
        router.replace("/me");
        return;
      }
      setLoad({ status: "ready", tokens: access.tokens, maxLive: access.maxLive });
    } catch {
      setLoad({ status: "failed" });
    }
  }, [router]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refresh]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const tokens = load.status === "ready" ? orderTokens(load.tokens) : [];
  const arrived = useArrivals(tokens.map((t) => t.id), "tokens");

  if (!userId || load.status === "loading") return null;

  const atCap = load.status === "ready" && liveCount(load.tokens) >= load.maxLive;

  const create = async () => {
    const name = label.trim();
    if (!name) {
      setError("Give it a label, so you know what to revoke later.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setMinted(await mintToken(name, days));
      setCopied(false);
      setLabel("");
      setDays(DEFAULT_EXPIRY_CHOICE);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t create a token. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // Blocked clipboard: the token is selectable text right there, so this
      // is a lost convenience, not a lost token.
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await revokeToken(id);
      setConfirming(null);
      if (minted?.id === id) setMinted(null);
      await refresh();
    } catch {
      setError("Couldn’t revoke that token. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" onClick={() => router.push("/me")} aria-label="Back to Me">
          ← Me
        </Button>
        <h1 className="m-0 text-display font-semibold">Connections</h1>
        <p className="m-0 text-body text-muted">
          Tokens that let a script read your sessions, program and maxes. Read-only. Revoke one and it stops working at once.
        </p>
      </header>

      {minted ? (
        <section
          aria-label="Your new token"
          className="motion-safe:animate-row-in flex flex-col gap-3 rounded-card border border-accent-line bg-surface p-4"
        >
          <p className="m-0 text-body font-semibold">{minted.label}</p>
          <p className="m-0 text-ui text-muted">Copy it now. It won’t be shown again.</p>
          {/* Selectable and mono: the fallback when the clipboard is blocked. */}
          <code className="select-all break-all rounded-control bg-surface-2 p-3 font-mono text-ui">{minted.token}</code>
          <div className="flex gap-2">
            <Button block onClick={() => void copy(minted.token)}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button block variant="secondary" onClick={() => setMinted(null)}>
              Done
            </Button>
          </div>
          <span aria-live="polite" className="sr-only">
            {copied ? "Token copied" : ""}
          </span>
        </section>
      ) : null}

      <form
        aria-label="New token"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <TextField
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
            setError(null);
          }}
          aria-label="Token label"
          placeholder="Label, e.g. Rubble"
          maxLength={API_TOKEN_LABEL_MAX}
          autoComplete="off"
          enterKeyHint="done"
          invalid={Boolean(error)}
          disabled={atCap}
        />
        <div role="radiogroup" aria-label="Expires after" className="flex flex-wrap items-center gap-2">
          <span className="text-ui text-muted">Expires after</span>
          {EXPIRY_CHOICES.map((choice) => (
            <Chip
              key={choice}
              role="radio"
              aria-checked={days === choice}
              tone={days === choice ? "selected" : "outline"}
              onClick={() => setDays(choice)}
              disabled={atCap}
            >
              {choice} days
            </Chip>
          ))}
        </div>
        {error ? (
          <p role="alert" className="m-0 text-caption text-foreground">
            {error}
          </p>
        ) : atCap ? (
          <p className="m-0 text-caption text-muted">
            {load.status === "ready" ? load.maxLive : 5} active tokens is the limit. Revoke one to make another.
          </p>
        ) : null}
        <Button type="submit" disabled={busy || atCap}>
          {busy ? "Creating…" : "Create token"}
        </Button>
      </form>

      {load.status === "failed" ? (
        <p role="status" className="m-0 text-body text-muted">
          Couldn’t load your tokens. Check your connection and come back.
        </p>
      ) : tokens.length === 0 ? (
        <EmptyState title="No tokens yet" body="A token you create shows here, with when it was last used." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Tokens">
          {tokens.map((token) => (
            <li
              key={token.id}
              className={`flex flex-col gap-2 rounded-card border border-border p-3 ${arrived(token.id) ? "motion-safe:animate-row-in" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={`text-body font-semibold ${token.state === "live" ? "" : "text-muted"}`}>{token.label}</span>
                <Chip tone={token.state === "live" ? "success" : "outline"}>{stateLabel(token.state)}</Chip>
              </div>
              <span className="text-caption text-muted">{datesLine(token)}</span>
              <span className="text-caption text-muted">{lastUsedLine(token)}</span>
              {token.state !== "live" ? null : confirming === token.id ? (
                <div role="alert" className="flex flex-col gap-2 border-t border-border pt-2">
                  <p className="m-0 text-ui">Revoke “{token.label}”? Anything using it stops working straight away.</p>
                  <div className="flex gap-2">
                    <Button block variant="secondary" size="sm" onClick={() => setConfirming(null)} disabled={busy}>
                      Keep it
                    </Button>
                    <Button block variant="danger" size="sm" onClick={() => void revoke(token.id)} disabled={busy}>
                      Revoke
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex">
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(token.id)} aria-label={`Revoke ${token.label}`}>
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
