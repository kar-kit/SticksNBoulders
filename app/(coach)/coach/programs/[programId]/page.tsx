import { ProgramEditor } from "@/components/coach/program-editor";

export const metadata = { title: "Program Editor — Sticks N Boulders" };

/**
 * The Program Editor, Order 19. Reads through the coach's session; writes go
 * through /api/program, which re-checks the coach and the link on every op.
 */
export default async function ProgramEditorPage(props: PageProps<"/coach/programs/[programId]">) {
  const { programId } = await props.params;
  return <ProgramEditor programId={programId} />;
}
