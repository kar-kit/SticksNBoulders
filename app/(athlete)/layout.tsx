import { AthleteShell } from "@/components/shell/athlete-shell";
import { AthleteProviders } from "./providers";

export default function AthleteLayout({ children }: LayoutProps<"/">) {
  return (
    <AthleteShell>
      <AthleteProviders>{children}</AthleteProviders>
    </AthleteShell>
  );
}
