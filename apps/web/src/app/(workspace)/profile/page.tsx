'use client';

import { useRouter } from 'next/navigation';
import { Building2, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { useTenant } from '@/lib/tenant';
import { formatDate, initials } from '@/lib/utils';
import { PageHeader } from '@/components/app/page-header';
import { ErrorState } from '@/components/app/error-state';
import { SkeletonCards } from '@/components/app/loading';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { MembershipListItem } from '@catlium/contracts';

const ROLE_LABELS: Record<string, string> = {
  INSTITUTE_ADMIN: 'Institute Admin',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
};

function RoleBadges({ roles }: { roles: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <Badge key={role} variant="secondary">
          {ROLE_LABELS[role] ?? role}
        </Badge>
      ))}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, memberships, loading, logout } = useAuth();
  const { institute } = useTenant();

  if (loading || !user) {
    return (
      <div className="space-y-6">
        <PageHeader title="Profile" description="Your account and institute memberships." />
        <SkeletonCards count={2} />
      </div>
    );
  }

  const handleSignOut = async () => {
    await logout();
    router.replace('/login');
  };

  const sortedMemberships = [...memberships].sort((a, b) => {
    if (a.instituteId === institute?.instituteId) return -1;
    if (b.instituteId === institute?.instituteId) return 1;
    return a.instituteName.localeCompare(b.instituteName);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Your account details and the institutes you belong to."
      />

      <Card>
        <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarFallback className="bg-primary/10 text-lg text-primary">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{user.name}</h2>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Mail className="size-3.5" />
                {user.email}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <UserRound className="size-3.5" />
                  {user.status === 'active' ? 'Active account' : user.status}
                </span>
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5" />
                  Member since {formatDate(user.createdAt)}
                </span>
              </div>
            </div>
          </div>
          <Button variant="secondary" className="sm:shrink-0" onClick={() => void handleSignOut()}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Institutes ({memberships.length})
        </h3>
        {memberships.length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              You do not belong to any institute yet. Your institute administrator creates and
              manages your account.
            </CardContent>
          </Card>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {sortedMemberships.map((membership: MembershipListItem) => {
            const current = membership.instituteId === institute?.instituteId;
            return (
              <Card
                key={membership.instituteId}
                className={current ? 'border-primary/40' : undefined}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="size-4 text-muted-foreground" />
                      {membership.instituteName}
                    </CardTitle>
                    {current && <Badge>Current</Badge>}
                  </div>
                  <CardDescription className="text-xs">
                    {membership.slug} ·{' '}
                    {membership.status === 'active' ? 'Active membership' : membership.status}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RoleBadges roles={membership.roles} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
