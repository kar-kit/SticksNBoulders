import { ProgramEditor } from "@/components/coach/program-editor";
import { landingFrom } from "@/lib/coach/adjust-program";

export const metadata = { title: "Program Editor — Sticks N Boulders" };

/**
 * The Program Editor, Order 19. Reads through the coach's session; writes go
 * through /api/program, which re-checks the coach and the link on every op.
 *
 * `?week=&day=&line=` is where "Adjust program" lands it (the day a reviewed
 * clip was prescribed from). Only a starting position: it grants nothing, and
 * an id that is not in this program is simply not found.
 */
export default async function ProgramEditorPage(props: PageProps<"/coach/programs/[programId]">) {
  const [{ programId }, query] = await Promise.all([props.params, props.searchParams]);
  return <ProgramEditor programId={programId} landing={landingFrom(query)} />;
}
