"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { currentUser, signOut } from "@/lib/auth/session";

export function TodayPlaceholder() {
  const router = useRouter();
  const [state, setState] = useState<{ status: "loading" } | { status: "out" } | { status: "in"; name: string; email: string }>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    void currentUser().then((result) => {
      if (cancelled) return;
      if (result.ok) setState({ status: "in", name: result.value.name, email: result.value.email });
      else setState({ status: "out" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status === "out") router.replace("/sign-in");
  }, [state.status, router]);

  if (state.status !== "in") {
    return <main className="flex min-h-dvh items-center justify-center" aria-busy="true" />;
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center gap-4 px-6">
      <p className="m-0 font-mono text-label text-muted-2 uppercase">Signed in</p>
      <p className="m-0 text-display font-semibold">{state.name}</p>
      <p className="m-0 text-body text-muted">{state.email}</p>
      <p className="m-0 text-caption text-muted-2">
        The real Today screen is Order 7. This exists so sign-in has somewhere to land.
      </p>
      <Button
        variant="secondary"
        onClick={async () => {
          await signOut();
          router.replace("/sign-in");
        }}
      >
        Sign out
      </Button>
    </main>
  );
}
