"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import PageSpinner from "@/components/PageSpinner";

export default function Home() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/sign-in");
    else if (!profile) router.replace("/onboarding");
    else router.replace("/dashboard");
  }, [loading, user, profile, router]);

  return <PageSpinner />;
}
