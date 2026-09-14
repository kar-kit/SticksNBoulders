import { AthleteShell } from "@/components/shell/athlete-shell";

export default function AthleteLayout({ children }: LayoutProps<"/">) {
  return <AthleteShell>{children}</AthleteShell>;
}
