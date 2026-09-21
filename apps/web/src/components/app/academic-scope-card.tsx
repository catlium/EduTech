'use client';

import { Compass, RefreshCw } from 'lucide-react';

import { useMyScope } from '@/lib/use-my-scope';
import { useTenant, isInstituteAdmin } from '@/lib/tenant';
import { groupOfferingsByClass } from '@/lib/scope';
import { SectionHeader } from '@/components/app/section-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// "My academic scope" — the actor's own Class → Subject / Year → Class →
// Division scope from GET /memberships/scope. Presentation only; the API is
// the authority.
export function AcademicScopeCard({ variant }: { variant: 'teacher' | 'student' }) {
  const { institute } = useTenant();
  const isAdmin = isInstituteAdmin(institute);
  const { scope, error, refresh } = useMyScope();
  const wholeInstitute = isAdmin || scope?.kind === 'whole-institute';

  return (
    <section>
      <SectionHeader title="My academic scope" />
      <Card>
        <CardContent className="px-4 py-4">
          {!scope && !error ? (
            <p className="text-sm text-muted-foreground">Loading scope…</p>
          ) : error ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Could not load your academic scope.</p>
              <Button variant="ghost" size="sm" onClick={refresh}>
                <RefreshCw className="mr-1 size-3.5" /> Retry
              </Button>
            </div>
          ) : wholeInstitute ? (
            <p className="text-sm text-muted-foreground">
              Institute-wide access across every class and subject.
            </p>
          ) : variant === 'teacher' ? (
            <ScopeOfferings />
          ) : (
            <ScopePlacementInfo />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ScopeOfferings() {
  const { scope } = useMyScope();
  const groups = groupOfferingsByClass(scope?.offerings ?? []);
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No assigned Class → Subject offerings yet. Content you create or manage is scoped to
        what an institute admin assigns you.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {groups.map((group) => (
        <span
          key={group.classId}
          className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-sm"
        >
          <Compass className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{group.className}</span>
          <span className="text-muted-foreground">· {group.subjects.join(', ')}</span>
        </span>
      ))}
    </div>
  );
}

function ScopePlacementInfo() {
  const { scope } = useMyScope();
  const placement = scope?.placement ?? null;
  if (!placement) {
    return (
      <p className="text-sm text-muted-foreground">
        No active class placement yet — subjects appear once your institute places you in an
        Academic Year, Class and Division.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {[placement.academicYearName, placement.className, placement.divisionName].map((part) => (
        <span
          key={part}
          className="inline-flex items-center rounded-full border bg-background px-3 py-1 text-sm font-medium"
        >
          {part}
        </span>
      ))}
    </div>
  );
}