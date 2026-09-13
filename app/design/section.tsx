import type { ReactNode } from "react";

export function Panel({
  label,
  width = 560,
  children,
}: {
  label: string;
  width?: number;
  children: ReactNode;
}) {
  return (
    <section
      // Lets scripts/shot.mjs capture one panel for a PR body.
      data-shot={label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
      style={{ width }}
      className="flex max-w-full flex-col gap-[18px] overflow-x-auto rounded-card border border-border bg-background p-6"
    >
      <h2 className="m-0 font-mono text-label text-muted-2 uppercase">{label}</h2>
      {children}
    </section>
  );
}

export function Rule() {
  return <div className="h-px bg-border" />;
}

export function Caption({ children }: { children: ReactNode }) {
  return <span className="font-mono text-meta text-muted-2">{children}</span>;
}
