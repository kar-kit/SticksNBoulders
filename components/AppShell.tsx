"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import BottomNav from "./BottomNav";

const NO_NAV_ROUTES = ["/", "/sign-in", "/onboarding"];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showNav = !NO_NAV_ROUTES.includes(pathname);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <main className="flex-1 overflow-y-auto">{children}</main>
      {showNav && <BottomNav />}
    </div>
  );
}
