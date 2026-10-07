/**
 * Runs once when the server starts, before it takes a request.
 *
 * It refuses to boot a production server that cannot sign clip URLs. Next
 * skips this hook itself during `next build` (instrumentation-globals checks
 * NEXT_PHASE), and the check repeats that exemption rather than rely on it.
 */
export async function register() {
  // Node only: the check reads node:crypto via the ticket module, and the edge
  // bundle must not pull that in. Dynamic import keeps it out of that graph.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { checkVideoTicketSecret } = await import("@/lib/video/startup-check");
  const result = checkVideoTicketSecret({
    env: process.env,
    nodeEnv: process.env.NODE_ENV,
    phase: process.env.NEXT_PHASE,
  });

  if (result.status === "fail") throw new Error(result.message);
  if (result.status === "warn") console.warn(`[startup] ${result.message}`);
}
