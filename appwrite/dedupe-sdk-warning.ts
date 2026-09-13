/**
 * Appwrite returns a version-mismatch warning in a header on every response,
 * and the SDK prints each one, so a setup run emits the same sentence forty
 * times and buries the output that matters.
 *
 * This prints it once and drops the repeats. It does not silence it: the
 * mismatch is real and worth fixing. The server is 1.9.0 and the newest SDK
 * targets 1.9.6, so upgrading the self-hosted instance clears it for good.
 *
 * CLI scripts only. Application code should not be patching console.
 */
export function dedupeSdkWarnings(): void {
  const seen = new Set<string>();
  const original = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (first.includes("current SDK is built for Appwrite")) {
      if (seen.has(first)) return;
      seen.add(first);
    }
    original(...args);
  };
}
