'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, LayoutDashboard, LogOut, ShieldCheck, UsersRound } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { BrandMark } from '@/components/app/brand-logo';
import { ThemeToggle } from '@/components/app/theme-toggle';
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

const platformNav = [
  { href: '/platform/institutes', label: 'Institutes', icon: Building2 },
  { href: '/platform/users', label: 'Users', icon: UsersRound },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

// Platform console navigation (Phase N.5). Its own sidebar because the console
// lives outside the institute workspace: no institute switcher, no tenant
// context — the platform plane only.
export function PlatformSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/platform/institutes">
                <BrandMark />
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">CatLium EduTech</span>
                  <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <ShieldCheck className="size-3" /> Platform console
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Super Admin</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {platformNav.map((item) => (
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
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/institutes" className="cursor-pointer">
                <LayoutDashboard className="size-4" />
                <span>Institute workspaces</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => logout()}>
              <LogOut className="size-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className={cn('grid min-w-0 leading-tight')}>
            <span className="truncate text-xs font-medium text-foreground">{user?.name}</span>
            <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
          </div>
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

export function platformCrumb(pathname: string): { label: string; href: string } | null {
  if (pathname === '/platform/institutes' || pathname.startsWith('/platform/institutes/')) {
    return { label: 'Institutes', href: '/platform/institutes' };
  }
  if (pathname === '/platform/users' || pathname.startsWith('/platform/users/')) {
    return { label: 'Users', href: '/platform/users' };
  }
  return null;
}
