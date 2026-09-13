"use client";

import { useId, useState } from "react";
import { FieldLabel, TextField } from "@/components/ui/input";
import { cn } from "@/lib/cn";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M1.5 10S4.6 4.5 10 4.5 18.5 10 18.5 10 15.4 15.5 10 15.5 1.5 10 1.5 10z" />
      <circle cx="10" cy="10" r="2.6" />
      {off ? <path d="M3 3l14 14" /> : null}
    </svg>
  );
}

export interface PasswordFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  /** "current-password" when signing in, "new-password" when creating. */
  autoComplete: "current-password" | "new-password";
  /** Rendered right-aligned under the field, e.g. the Forgot link. */
  trailing?: React.ReactNode;
  hint?: string;
}

export function PasswordField({
  label = "Password",
  value,
  onChange,
  invalid,
  autoComplete,
  trailing,
  hint,
}: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <TextField
          id={id}
          size="lg"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          invalid={invalid}
          // Without this the iOS keychain and every password manager stay
          // silent, which is what actually makes passwords painful.
          autoComplete={autoComplete}
          className={cn("pr-12", !visible && value ? "tracking-[0.18em]" : undefined)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted"
        >
          <EyeIcon off={visible} />
        </button>
      </div>
      {hint ? <span className="text-caption text-muted-2">{hint}</span> : null}
      {trailing ? <div className="self-end">{trailing}</div> : null}
    </div>
  );
}
