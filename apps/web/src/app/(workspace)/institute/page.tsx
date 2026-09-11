'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Building2, ShieldCheck, UserPlus, Users, UserCog } from 'lucide-react';

import { api } from '@/lib/api';
import { useTenant } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { StatCard } from '@/components/app/stat-card';
import { SkeletonCards } from '@/components/app/loading';
import { ErrorState } from '@/components/app/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { InstituteUser, SubjectResponse } from '@catlium/contracts';

export default function InstitutePage() {
  const { institute } = useTenant();
  const [users, setUsers] = useState<InstituteUser[] | null>(null);
  const [subjects, setSubjects] = useState<SubjectResponse[] | null>(null);
  const [error, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const load = useCallback(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    setError(false);
    Promise.all([
      api<{ users: InstituteUser[] }>('/users', { signal: ctrl.signal }),
      api<{ subjects: SubjectResponse[] }>('/academic/subjects', { signal: ctrl.signal }),
    ])
      .then(([u, s]) => {
        setUsers(u.users ?? []);
        setSubjects(s.subjects ?? []);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(true);
      });
    return () => ctrl.abort();
  }, [institute, retryToken]);

  useEffect(() => load(), [load]);

  function onRetry() {
    setUsers(null);
    setSubjects(null);
    setRetryToken((t) => t + 1);
  }

  const teachers = users?.filter((u) => u.roles.includes('TEACHER')) ?? [];
  const students = users?.filter((u) => u.roles.includes('STUDENT')) ?? [];
  const active = users?.filter((u) => u.status === 'active') ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={institute?.instituteName || 'Institute'}
        description="Manage your institute's accounts and see what lives inside your tenant-scoped workspace."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/users">
                <Users className="mr-1.5 size-4" /> Manage users
              </Link>
            </Button>
            <Button asChild>
              <Link href="/users?create=1">
                <UserPlus className="mr-1.5 size-4" /> Add user
              </Link>
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorState onRetry={onRetry} />
      ) : users === null || subjects === null ? (
        <SkeletonCards count={4} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Users}
              label="Members"
              value={users.length}
              hint={`${active.length} active`}
              href="/users"
            />
            <StatCard
              icon={UserCog}
              label="Teachers"
              value={teachers.length}
              hint="Provisioned by admins"
              href="/users"
            />
            <StatCard
              icon={ShieldCheck}
              label="Students"
              value={students.length}
              hint="No public sign-up"
              href="/users"
            />
            <StatCard
              icon={BookOpen}
              label="Subjects"
              value={subjects.length}
              hint="In this institute"
              href="/subjects"
            />
          </div>

          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-primary" />
                <h3 className="text-sm font-semibold">How accounts work here</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                CatLium EduTech is a multi-tenant platform. Accounts are scoped to an institute:
                administrators provision teachers and students, and there is no public
                self-registration. Deactivated members lose access to this institute until an
                administrator reactivates them.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
