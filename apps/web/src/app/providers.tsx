"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import { TenantProvider } from "@/lib/tenant";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <TenantProvider>{children}</TenantProvider>
    </AuthProvider>
  );
}