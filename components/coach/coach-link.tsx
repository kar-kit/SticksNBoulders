"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldLabel, TextField } from "@/components/ui/input";
import { useSession } from "@/lib/auth/session-context";
import { INVITE_PREFIX, normaliseInviteCode } from "@/lib/coach/invite-code";
import { linkConsentSentence, linkedDateLabel, unlinkConsequenceSentence } from "@/lib/coach/link";
import {
  fetchMyCoach,
  redeemCode,
  resolveCode,
  unlinkCoach,
  type MyCoach,
} from "@/lib/coach/link-store";

/**
 * The COACH section: who can see this athlete's training, and how to let
 * somebody in.
 *
 * The confirm step is not a nicety. The blueprint is explicit that the
 * consequence must be stated at the moment of redeeming rather than in a
 * privacy policy, and under UK GDPR this is the moment consent actually
 * happens -- so the coach is named, in a sentence, before anything is written.
 * A code that linked on submit would be faster and would not be consent.
 */

type State =
  | { status: "loading" }
  | { status: "solo" }
  | { status: "resolving" }
  | { status: "confirming"; coachId: string; coachName: string }
  | { status: "linking"; coachName: string }
  | { status: "linked"; coach: MyCoach }
  | { status: "unlinking-confirm"; coach: MyCoach }
  | { status: "unlinking"; coach: MyCoach }
  | { status: "refused"; message: string };

export function CoachLink() {
  const { state: session, refresh } = useSession();
  const [state, setState] = useState<State>({ status: "loading" });
  const [code, setCode] = useState("");
  const codeId = useId();

  const athleteId = session.status === "signed-in" ? session.user.id : null;

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    void (async () => {
      // A lookup that cannot reach the server is an athlete with no signal,
      // not an athlete with no coach. Both show the same thing here, and the
      // code field still works when the signal comes back.
      const coach = await fetchMyCoach().catch(() => null);
      if (!cancelled) setState(coach ? { status: "linked", coach } : { status: "solo" });
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  if (!athleteId || state.status === "loading") return null;

  const typed = normaliseInviteCode(code);

  const look = async () => {
    if (!typed) {
      setState({ status: "refused", message: "That isn't a code. Check it and try again." });
      return;
    }
    setState({ status: "resolving" });
    try {
      const found = await resolveCode(typed);
      if (found.status === "found") {
        setState({ status: "confirming", coachId: found.coachId, coachName: found.coachName });
      } else if (found.status === "self") {
        setState({ status: "refused", message: "That's your own code." });
      } else {
        setState({ status: "refused", message: "We don't know that code. Check it with your coach." });
      }
    } catch {
      setState({ status: "refused", message: "Couldn't reach the server. Try again." });
    }
  };

  const link = async (coachName: string) => {
    setState({ status: "linking", coachName });
    try {
      const result = await redeemCode(typed ?? code);
      if (result.status === "linked" || result.status === "already-linked") {
        setCode("");
        setState({
          status: "linked",
          coach: { coachId: result.coachId, coachName: result.coachName, linkedAt: new Date() },
        });
        // The shell shows a coach-mode switch based on links, so the session's
        // view of them is now stale.
        await refresh();
      } else if (result.status === "linked-not-visible") {
        // Deliberately not reported as success. The link exists and the coach
        // cannot see anything yet, and only saying so gets anyone to retry.
        setState({
          status: "refused",
          message: "Linked, but your coach can't see your training yet. Try the code again.",
        });
      } else if (result.status === "other-coach") {
        setState({
          status: "refused",
          message: `You're already linked to ${result.coachName || "a coach"}. There's no way to switch yet.`,
        });
      } else if (result.status === "self") {
        setState({ status: "refused", message: "That's your own code." });
      } else {
        setState({ status: "refused", message: "We don't know that code. Check it with your coach." });
      }
    } catch {
      setState({ status: "refused", message: "Couldn't reach the server. Try again." });
    }
  };

  const unlink = async (coach: MyCoach) => {
    setState({ status: "unlinking", coach });
    try {
      const result = await unlinkCoach();
      if (result.status === "unlinked" || result.status === "not-linked") {
        setState({ status: "solo" });
        await refresh();
      } else {
        // Nothing was written and the coach may still be able to see
        // everything. Saying so is the only thing that gets anyone to retry.
        setState({
          status: "refused",
          message: "Couldn't remove their access. Nothing changed — try again.",
        });
      }
    } catch {
      setState({ status: "refused", message: "Couldn't reach the server. Try again." });
    }
  };

  return (
    <section aria-label="Coach" className="flex flex-col items-start gap-2">
      <h2 className="m-0 text-caption font-semibold tracking-wide text-muted-2">COACH</h2>

      {state.status === "linked" ? (
        <>
          <span className="text-body font-semibold">{state.coach.coachName || "Your coach"}</span>
          {state.coach.linkedAt ? (
            <span className="text-ui text-muted">{linkedDateLabel(state.coach.linkedAt)}</span>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setState({ status: "unlinking-confirm", coach: state.coach })}
          >
            Unlink
          </Button>
        </>
      ) : state.status === "unlinking-confirm" ? (
        <>
          <span className="text-body font-semibold">
            Unlink {state.coach.coachName || "your coach"}?
          </span>
          {/* Named and specific, the mirror of the linking sentence. Consent
              has to be as easy to withdraw as it was to give, which does not
              mean withdrawing it should be careless. */}
          <p className="m-0 max-w-[340px] text-ui text-muted">
            {unlinkConsequenceSentence(state.coach.coachName)}
          </p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => void unlink(state.coach)}>
              Unlink
            </Button>
            <Button
              variant="secondary"
              onClick={() => setState({ status: "linked", coach: state.coach })}
            >
              Keep
            </Button>
          </div>
        </>
      ) : state.status === "unlinking" ? (
        <span className="text-ui text-muted">
          Removing {state.coach.coachName || "your coach"}&rsquo;s access…
        </span>
      ) : state.status === "confirming" ? (
        <>
          <span className="text-body font-semibold">
            Link with {state.coachName || "your coach"}?
          </span>
          {/* The sentence consent is given to. Named, specific, and on screen
              before anything is written. */}
          <p className="m-0 max-w-[340px] text-ui text-muted">
            {linkConsentSentence(state.coachName)}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => void link(state.coachName)}>Link</Button>
            <Button variant="secondary" onClick={() => setState({ status: "solo" })}>
              Cancel
            </Button>
          </div>
        </>
      ) : state.status === "linking" ? (
        <span className="text-ui text-muted">Linking with {state.coachName || "your coach"}…</span>
      ) : (
        <>
          <span className="text-body">Not linked</span>
          <FieldLabel htmlFor={codeId}>Enter a coach code</FieldLabel>
          <TextField
            id={codeId}
            value={code}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder={`${INVITE_PREFIX}_____`}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button
            variant="secondary"
            disabled={state.status === "resolving" || code.trim().length === 0}
            onClick={() => void look()}
          >
            {state.status === "resolving" ? "Checking…" : "Link my coach"}
          </Button>
          {state.status === "refused" ? (
            <p role="alert" className="m-0 max-w-[340px] text-ui text-muted">
              {state.message}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
