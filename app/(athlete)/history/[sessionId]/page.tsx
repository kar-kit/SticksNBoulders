import { SessionDetail } from "./session-detail";

export const metadata = { title: "Session — Sticks N Boulders" };

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <SessionDetail sessionId={sessionId} />;
}
