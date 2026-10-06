import { ProgramList } from "@/components/coach/program-list";

export const metadata = { title: "Programs — Sticks N Boulders" };

/**
 * Programs, Order 19. A client component underneath: every read goes through
 * the coach's own Appwrite session, so the permissions stamped on each program
 * row decide what is listed.
 */
export default function ProgramsPage() {
  return <ProgramList />;
}
