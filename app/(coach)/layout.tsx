import { CoachLayoutShell } from "./coach-layout-shell";

export default function CoachLayout({ children }: LayoutProps<"/">) {
  return <CoachLayoutShell>{children}</CoachLayoutShell>;
}
