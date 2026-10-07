import { AdjustProgram } from "@/components/coach/adjust-program";
import { ProgramList } from "@/components/coach/program-list";
import { idParam } from "@/lib/coach/adjust-program";

export const metadata = { title: "Programs — Sticks N Boulders" };

/**
 * Programs, Order 19. A client component underneath: every read goes through
 * the coach's own Appwrite session, so the permissions stamped on each program
 * row decide what is listed.
 *
 * `?athlete=<id>[&line=<prescriptionId>]` is "Adjust program", from a clip or
 * from Athlete View: it checks the link, then hands over to the editor on the
 * right week and day (components/coach/adjust-program.tsx). An id that is not
 * an id is ignored and the index is shown.
 */
export default async function ProgramsPage({ searchParams }: PageProps<"/coach/programs">) {
  const query = await searchParams;
  const athleteId = idParam(query.athlete);
  if (athleteId) return <AdjustProgram athleteId={athleteId} lineId={idParam(query.line)} />;
  return <ProgramList />;
}
