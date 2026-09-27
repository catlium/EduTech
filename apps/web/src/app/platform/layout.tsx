'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { usePlatform } from '@/lib/platform';
import {
  FORBIDDEN_EVENT,
  isPrimaryForbiddenPath,
  type ForbiddenDetail,
} from '@/lib/api';
import { PlatformSidebar, platformCrumb } from '@/components/app/platform-sidebar';
import { AppBreadcrumbs } from '@/components/app/app-breadcrumbs';
import { PageLoader } from '@/components/app/loading';
import { EmptyState } from '@/components/app/empty-state';
import { UserMenu } from '@/components/app/user-menu';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

function PlatformForbidden() {
  const { logout } = useAuth();
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        icon={<AlertTriangle className="size-5" />}
        title="No access"
        description="This area is reserved for CatLium platform administrators (Super Admin console)."
      >
        <Button variant="ghost" size="sm" onClick={() => logout()}>
          Sign out
        </Button>
      </EmptyState>
    </main>
  );
}

// Platform console gate (Phase N.5): like the workspace AuthGuard it needs a
// signed-in user, but it never consults memberships/x-institute-id — the
// console is the platform plane, and a user with zero institute memberships
// can still be a platform admin. Permission gating is UX-only against the
// DB-fresh /platform/permissions probe; the backend re-checks every call.
function PlatformGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { loading: probeLoading, canAccessConsole } = usePlatform();

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [loading, router, user]);

  if (loading || probeLoading) return <PageLoader />;
  if (!user) return null;
  if (!canAccessConsole) return <PlatformForbidden />;
  return <>{children}</>;
}

// F5.6/L-1: the console's whole surface is `/platform/*`, so only a 403 on the
// page's own plane is a genuine page authorization failure. Anything else
// (institute-plane reads, a background fetch) surfaces locally instead of
// replacing the console with an access-denied view. PlatformGate already
// denies a caller without `institutes.read` before this ever renders.
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

  if (forbiddenPath !== null && isPrimaryForbiddenPath(forbiddenPath, ['/platform'])) {
    return <PlatformForbidden />;
  }
  return <>{children}</>;
}

function Crumb() {
  const pathname = usePathname();
  const crumb = platformCrumb(pathname);
  if (!crumb) return null;
  return <AppBreadcrumbs items={[{ label: crumb.label, href: crumb.href }]} />;
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlatformGate>
      <SidebarProvider>
        <PlatformSidebar />
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
              <ForbiddenGate>{children}</ForbiddenGate>
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </PlatformGate>
  );
}
