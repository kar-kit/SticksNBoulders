import { LiftScreen } from "./lift-screen";

export const metadata = { title: "Lift — Sticks N Boulders" };

export default async function LiftPage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params;
  return <LiftScreen exerciseId={exerciseId} />;
}
