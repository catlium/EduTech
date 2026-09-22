'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { usePlatform } from '@/lib/platform';
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
    if (!loading && !user) router.replace('/login');
  }, [loading, router, user]);

  if (loading || probeLoading) return <PageLoader />;
  if (!user) return null;
  if (!canAccessConsole) return <PlatformForbidden />;
  return <>{children}</>;
}

function ForbiddenGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    setForbidden(false);
  }, [pathname]);

  useEffect(() => {
    const onForbidden = () => setForbidden(true);
    window.addEventListener('catlium:forbidden', onForbidden);
    return () => window.removeEventListener('catlium:forbidden', onForbidden);
  }, []);

  if (forbidden) return <PlatformForbidden />;
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
