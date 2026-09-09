"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  HelpCircle,
  ClipboardList,
  ScrollText,
  Target,
  GraduationCap,
  LogOut,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useTenant, canManage } from "@/lib/tenant";
import { BrandMark } from "@/components/app/brand-logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { InstituteSwitcher } from "@/components/app/institute-switcher";
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
} from "@/components/ui/sidebar";

const teacherNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/subjects", label: "Subjects", icon: BookOpen },
  { href: "/materials", label: "Materials", icon: FileText },
  { href: "/questions", label: "Question Bank", icon: HelpCircle },
  { href: "/assessments", label: "Assessments", icon: ClipboardList },
  { href: "/paper-patterns", label: "Paper Patterns", icon: ScrollText },
];

const studentNav = [
  { href: "/student/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/student/learning", label: "My Subjects", icon: GraduationCap },
];

const sharedNav = [{ href: "/practice", label: "Practice", icon: Target }];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { institute } = useTenant();
  const teacher = canManage(institute);

  const primary = teacher ? teacherNav : studentNav;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={teacher ? "/dashboard" : "/student/dashboard"}>
                <BrandMark />
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">CatLium EduTech</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {teacher ? "Teaching workspace" : "Student learning"}
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
          <SidebarGroupLabel>{teacher ? "Teaching" : "Student"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primary.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(pathname, item.href)}
                  >
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
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(pathname, item.href)}
                  >
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
    { href: "/dashboard", label: "Dashboard" },
    { href: "/subjects", label: "Subjects" },
    { href: "/materials", label: "Materials" },
    { href: "/questions", label: "Question Bank" },
    { href: "/assessments", label: "Assessments" },
    { href: "/paper-patterns", label: "Paper Patterns" },
    { href: "/student/dashboard", label: "Dashboard" },
    { href: "/student/learning", label: "My Subjects" },
    { href: "/practice", label: "Practice" },
  ];
  for (const item of map) {
    if (pathname === item.href || pathname.startsWith(item.href + "/")) {
      return item;
    }
  }
  return null;
}