'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth';
import { useTenant, canManage, isInstituteAdmin } from '@/lib/tenant';
import { AppSidebar, sideCrumb } from '@/components/app/app-sidebar';
import { AppBreadcrumbs } from '@/components/app/app-breadcrumbs';
import { Forbidden } from '@/components/app/forbidden';
import { PageLoader } from '@/components/app/loading';
import { UserMenu } from '@/components/app/user-menu';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

const TEACHER_ONLY_PREFIXES = [
  '/dashboard',
  '/subjects',
  '/materials',
  '/questions',
  '/assessments',
  '/paper-patterns',
];

const ADMIN_ONLY_PREFIXES = ['/institute', '/users'];

function isTeacherOnly(pathname: string): boolean {
  return TEACHER_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

function isAdminOnly(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, memberships } = useAuth();
  const { instituteId } = useTenant();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
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
  const admin = isInstituteAdmin(institute);

  useEffect(() => {
    if (!teacher && pathname === '/dashboard') {
      router.replace('/student/dashboard');
    }
  }, [pathname, router, teacher]);

  if (isAdminOnly(pathname) && !admin) {
    return <Forbidden />;
  }

  const teacherOnly = isTeacherOnly(pathname);
  if (teacherOnly && !teacher) {
    return <Forbidden />;
  }
  return <>{children}</>;
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
              <RoleGuard>{children}</RoleGuard>
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
