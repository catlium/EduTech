'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth';
import { useTenant, canManage, isInstituteAdmin, hasPermission } from '@/lib/tenant';
import { AppSidebar, sideCrumb } from '@/components/app/app-sidebar';
import { AppBreadcrumbs } from '@/components/app/app-breadcrumbs';
import { Forbidden } from '@/components/app/forbidden';
import { PageLoader } from '@/components/app/loading';
import { UserMenu } from '@/components/app/user-menu';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

// Route → read permission (Phase J). The teaching workspace stays role-split
// (canManage), then each route additionally requires its resource read key so
// hidden/deep-linked surfaces meet the same decision the API applies. Keys
// come straight from the backend catalogue; `manage` implies `read`.
const TEACHER_RESOURCE_ROUTES = [
  { prefix: '/subjects', key: 'subjects.read' },
  { prefix: '/materials', key: 'materials.read' },
  { prefix: '/content', key: 'content.read' },
  { prefix: '/questions', key: 'questions.read' },
  { prefix: '/assessments', key: 'assessments.read' },
  { prefix: '/question-papers', key: 'question-papers.read' },
  { prefix: '/paper-patterns', key: 'paper-patterns.read' },
  { prefix: '/syllabus', key: 'syllabus.read' },
  { prefix: '/jobs', key: 'jobs.read' },
];

const ADMIN_RESOURCE_ROUTES = [
  { prefix: '/institute', key: 'users.read' },
  { prefix: '/users', key: 'users.read' },
  // ocr-workers.* is platform-plane (D3/§15): no institute membership can hold
  // it, so the route is unreachable here by design (Super Admin UI is Phase K+).
  { prefix: '/ocr/workers', key: 'ocr-workers.read' },
];

function matchesPrefix(pathname: string, entries: { prefix: string; key: string }[]) {
  return entries.find(
    (entry) => pathname === entry.prefix || pathname.startsWith(entry.prefix + '/'),
  );
}

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
  const admin = isInstituteAdmin(institute);

  useEffect(() => {
    if (!teacher && pathname === '/dashboard') {
      router.replace('/student/dashboard');
    }
  }, [pathname, router, teacher]);

  const adminRoute = matchesPrefix(pathname, ADMIN_RESOURCE_ROUTES);
  if (adminRoute) {
    if (!admin || !hasPermission(institute, adminRoute.key)) {
      return <Forbidden />;
    }
    return <>{children}</>;
  }

  const teacherRoute = matchesPrefix(pathname, TEACHER_RESOURCE_ROUTES);
  if (teacherRoute) {
    if (!teacher || !hasPermission(institute, teacherRoute.key)) {
      return <Forbidden />;
    }
    return <>{children}</>;
  }

  if (pathname === '/dashboard') {
    return teacher ? <>{children}</> : <Forbidden />;
  }
  return <>{children}</>;
}

// Renders the shared access-denied view when a page-load GET answers 403
// (authenticated but not permitted/scoped). Resets on navigation. A 403 here
// never logs the user out — only the 401 refresh flow does that.
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

  if (forbidden) {
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
