'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  BookMarked,
  HelpCircle,
  ClipboardList,
  ScrollText,
  Target,
  GraduationCap,
  Building2,
  Users,
  Library,
  Activity,
  LogOut,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useTenant, canManage, isInstituteAdmin, hasPermission } from '@/lib/tenant';
import { BrandMark } from '@/components/app/brand-logo';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { InstituteSwitcher } from '@/components/app/institute-switcher';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

// Nav items carry the backend catalogue read key they need (the workspace
// split itself is role-based). `key: undefined` = workspace-level, no extra
// permission check. /ocr/workers is intentionally absent from administration:
// ocr-workers.* is platform-plane (D3/§15) and no institute membership can
// hold it — the layout Forbids the route, and Super Admin UI is out of scope.
const teacherNav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, key: undefined as string | undefined },
  { href: '/subjects', label: 'Subjects', icon: BookOpen, key: 'subjects.read' },
  { href: '/syllabus', label: 'Syllabi', icon: Library, key: 'syllabus.read' },
  { href: '/materials', label: 'Materials', icon: FileText, key: 'materials.read' },
  { href: '/content', label: 'Learning Content', icon: BookMarked, key: 'content.read' },
  { href: '/questions', label: 'Question Bank', icon: HelpCircle, key: 'questions.read' },
  { href: '/assessments', label: 'Assessments', icon: ClipboardList, key: 'assessments.read' },
  { href: '/question-papers', label: 'Question Papers', icon: FileText, key: 'question-papers.read' },
  { href: '/paper-patterns', label: 'Paper Patterns', icon: ScrollText, key: 'paper-patterns.read' },
  { href: '/jobs', label: 'Job Monitor', icon: Activity, key: 'jobs.read' },
];

const studentNav = [
  { href: '/student/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/student/learning', label: 'My Subjects', icon: GraduationCap },
  { href: '/student/exams', label: 'Exams', icon: ClipboardList },
];

const sharedNav = [{ href: '/practice', label: 'Practice', icon: Target }];

const adminNav = [
  { href: '/institute', label: 'Institute', icon: Building2, key: 'users.read' },
  { href: '/users', label: 'Users', icon: Users, key: 'users.read' },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

export function AppSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { institute } = useTenant();
  const teacher = canManage(institute);
  const admin = isInstituteAdmin(institute);

  const primary = teacher
    ? teacherNav.filter((item) => !item.key || hasPermission(institute, item.key))
    : studentNav;
  const adminLinks = adminNav.filter((item) => hasPermission(institute, item.key));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={teacher ? '/dashboard' : '/student/dashboard'}>
                <BrandMark />
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">CatLium EduTech</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {teacher ? 'Teaching workspace' : 'Student learning'}
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <InstituteSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{teacher ? 'Teaching' : 'Student'}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primary.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(pathname, item.href)}>
                    <Link href={item.href}>
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Study</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sharedNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(pathname, item.href)}>
                    <Link href={item.href}>
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {admin && adminLinks.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminLinks.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(pathname, item.href)}>
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => logout()}>
              <LogOut className="size-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="grid min-w-0 leading-tight">
            <span className="truncate text-xs font-medium text-foreground">{user?.name}</span>
            <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
          </div>
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

export function sideCrumb(pathname: string): { label: string; href: string } | null {
  const map = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/subjects', label: 'Subjects' },
    { href: '/syllabus', label: 'Syllabi' },
    { href: '/materials', label: 'Materials' },
    { href: '/content', label: 'Learning Content' },
    { href: '/questions', label: 'Question Bank' },
    { href: '/assessments', label: 'Assessments' },
    { href: '/question-papers', label: 'Question Papers' },
    { href: '/paper-patterns', label: 'Paper Patterns' },
    { href: '/jobs', label: 'Job Monitor' },
    { href: '/student/dashboard', label: 'Dashboard' },
    { href: '/student/learning', label: 'My Subjects' },
    { href: '/student/exams', label: 'Exams' },
    { href: '/practice', label: 'Practice' },
    { href: '/institute', label: 'Institute' },
    { href: '/users', label: 'Users' },
  ];
  for (const item of map) {
    if (pathname === item.href || pathname.startsWith(item.href + '/')) {
      return item;
    }
  }
  return null;
}
