"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-context";

/** Redirects to sign-in (or onboarding) once auth state resolves; renders nothing itself. */
export function useRequireAuth(requireProfile = true) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    if (requireProfile && !profile) {
      router.replace("/onboarding");
    }
  }, [loading, user, profile, requireProfile, router]);

  return { user, profile, loading };
}
