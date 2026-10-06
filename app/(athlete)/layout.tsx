import { AthleteShell } from "@/components/shell/athlete-shell";
import { FeedbackProvider } from "@/lib/review/feedback-context";
import { AthleteProviders } from "./providers";

export default function AthleteLayout({ children }: LayoutProps<"/">) {
  return (
    // Outside the shell, because the tab bar is in the shell and it is what
    // carries the unread dot.
    <FeedbackProvider>
      <AthleteShell>
        <AthleteProviders>{children}</AthleteProviders>
      </AthleteShell>
    </FeedbackProvider>
  );
}
