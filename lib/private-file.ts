/**
 * Fetches a private (file_security) Appwrite Storage URL and returns an object URL for it.
 *
 * A plain `<img src>` request carries no auth, so it works only when Appwrite sessions
 * are cookie-based. This project's Appwrite endpoint isn't a trusted first-party domain
 * from the browser's point of view, so the SDK falls back to storing the session in
 * localStorage and sends it via the `X-Fallback-Cookies` header on SDK-mediated calls
 * only -- an `<img>` tag never sees it. Fetching manually with that same header (the SDK
 * itself reads it from `localStorage.cookieFallback`) authenticates the request the same
 * way the SDK would.
 */
export async function fetchPrivateFileUrl(url: string): Promise<string> {
  const cookieFallback =
    typeof window !== "undefined" ? window.localStorage.getItem("cookieFallback") : null;

  const res = await fetch(url, {
    headers: cookieFallback ? { "X-Fallback-Cookies": cookieFallback } : undefined,
  });
  if (!res.ok) throw new Error(`Failed to load file (${res.status})`);

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
