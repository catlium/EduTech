'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth';
import { useTenant, canManage, isInstituteAdmin, hasPermission } from '@/lib/tenant';
import { FORBIDDEN_EVENT, isPrimaryForbiddenPath, type ForbiddenDetail } from '@/lib/api';
import { workspaceRoute } from '@/lib/workspace-routes';
import { AppSidebar, sideCrumb } from '@/components/app/app-sidebar';
import { AppBreadcrumbs } from '@/components/app/app-breadcrumbs';
import { Forbidden } from '@/components/app/forbidden';
import { PageLoader } from '@/components/app/loading';
import { UserMenu } from '@/components/app/user-menu';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, memberships } = useAuth();
  const { instituteId } = useTenant();

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [loading, router, user]);
  useEffect(() => {
    if (loading) return;
    if (user && memberships.length === 0) router.replace('/institutes');
  }, [loading, router, user, memberships]);
  useEffect(() => {
    if (loading) return;
    if (user && memberships.length > 0 && !instituteId) router.replace('/institutes');
  }, [loading, router, user, memberships, instituteId]);

  if (loading) {
    return <PageLoader />;
  }
  if (!user || (memberships.length > 0 && !instituteId)) return null;
  return <>{children}</>;
}

function RoleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { institute } = useTenant();
  const teacher = canManage(institute);

  useEffect(() => {
    if (!teacher && pathname === '/dashboard') {
      router.replace('/student/dashboard');
    }
  }, [pathname, router, teacher]);

  const gate = workspaceRoute(pathname);
  if (gate) {
    const roleOk =
      gate.role === null ||
      (gate.role === 'admin' ? isInstituteAdmin(institute) : teacher);
    if (!roleOk || !hasPermission(institute, gate.key)) {
      return <Forbidden />;
    }
    return <>{children}</>;
  }

  if (pathname === '/dashboard') {
    return teacher ? <>{children}</> : <Forbidden />;
  }
  return <>{children}</>;
}

// Renders the shared access-denied view when the page's OWN load answers 403
// (authenticated but not permitted/scoped), and only then. F5.6/L-1: the event
// carries the failing path, and a 403 on anything outside the current route's
// primary reads (a background poll, a sidebar count, a sub-section's roster
// fetch) is left to surface locally instead of blanking the whole workspace.
// Resets on navigation. A 403 here never logs the user out — only the 401
// refresh flow does that.
function ForbiddenGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [forbiddenPath, setForbiddenPath] = useState<string | null>(null);

  useEffect(() => {
    setForbiddenPath(null);
  }, [pathname]);

  useEffect(() => {
    const onForbidden = (event: Event) => {
      const detail = (event as CustomEvent<ForbiddenDetail>).detail;
      setForbiddenPath((prev) => prev ?? detail?.path ?? '');
    };
    window.addEventListener(FORBIDDEN_EVENT, onForbidden);
    return () => window.removeEventListener(FORBIDDEN_EVENT, onForbidden);
  }, []);

  if (forbiddenPath === null) {
    return <>{children}</>;
  }
  const load = workspaceRoute(pathname)?.load ?? [];
  return isPrimaryForbiddenPath(forbiddenPath, load) ? <Forbidden /> : <>{children}</>;
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-sm">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <Crumb />
            <div className="ml-auto flex items-center gap-1.5">
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 lg:p-8">
            <div className="mx-auto w-full max-w-6xl">
              <ForbiddenGate>
                <RoleGuard>{children}</RoleGuard>
              </ForbiddenGate>
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}

function Crumb() {
  const pathname = usePathname();
  const crumb = sideCrumb(pathname);
  if (!crumb) return null;
  return <AppBreadcrumbs items={[{ label: crumb.label, href: crumb.href }]} />;
}
