import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** A plain statement of what is not here. No apology, no illustration. */
  title: string;
  /** One sentence on what will fill it, or what the coach needs it for. */
  body?: string;
  /** At most one. Some empty states genuinely have no action. */
  action?: ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-control border border-dashed border-border p-7 text-center">
      <span className="text-title font-semibold">{title}</span>
      {body ? <p className="m-0 max-w-[360px] text-ui text-muted">{body}</p> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
