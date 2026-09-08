"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { AppSidebar } from "@/components/app/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, memberships } = useAuth();
  const { instituteId } = useTenant();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);
  useEffect(() => {
    if (loading) return;
    if (user && memberships.length === 0) router.replace("/institutes");
  }, [loading, router, user, memberships]);
  useEffect(() => {
    if (loading) return;
    if (user && memberships.length > 0 && !instituteId) router.replace("/institutes");
  }, [loading, router, user, memberships, instituteId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }
  if (!user || (memberships.length > 0 && !instituteId)) return null;
  return <>{children}</>;
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
          </header>
          <main className="flex-1 p-4 lg:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}