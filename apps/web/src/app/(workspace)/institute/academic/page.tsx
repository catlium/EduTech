'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, GraduationCap, Layers, School, UserRoundCheck, Users } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTenant } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { SkeletonRows } from '@/components/app/loading';
import { ErrorState } from '@/components/app/error-state';
import {
  canWriteAcademicStructure,
  bySortOrder,
  resolveConsoleLoad,
  canAssign as canAssignPermission,
  canTransfer as canTransferPermission,
  type AcademicYear,
  type ClassRow,
  type DivisionRow,
  type Offering,
} from '@/lib/academic';
import type { SubjectResponse } from '@catlium/contracts';

import { AcademicYearsSection } from './academic-years-section';
import { ClassesSection } from './classes-section';
import { DivisionsSection } from './divisions-section';
import { TeacherAssignmentsSection } from './assignments-section';
import { StudentPlacementsSection } from './placements-section';

// Stable identity so a missing membership cannot change the loader's identity
// and re-trigger its effect on every render.
const NO_GRANTS: readonly string[] = [];

export default function AcademicConsolePage() {
  const { institute } = useTenant();
  const grants = institute?.permissions ?? NO_GRANTS;
  const canCreateStructure = canWriteAcademicStructure(grants, 'create');
  const canUpdateStructure = canWriteAcademicStructure(grants, 'update');
  const canDeleteStructure = canWriteAcademicStructure(grants, 'delete');
  const canReadAssignments = canAssignPermission(grants, 'read');
  const canCreateAssignments = canAssignPermission(grants, 'create');
  const canDeleteAssignments = canAssignPermission(grants, 'delete');
  const canTransferPlacements = canTransferPermission(grants);

  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [offeredByClass, setOfferedByClass] = useState<Record<string, Offering[]>>({});
  const [subjectsDenied, setSubjectsDenied] = useState(false);
  const [subjectsFailed, setSubjectsFailed] = useState(false);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState('loading');
      // The four reads are settled INDEPENDENTLY. The structural three
      // (academic-structure.read) are page-critical, but the subject catalogue is
      // `subjects.read` — a different key from the one that gates this page — so
      // a role can reach the console and still be refused the catalogue. Before
      // F5.9 one Promise.all let that single 403 reject and blank the whole
      // console; now it degrades (see resolveConsoleLoad).
      const settle = async <T,>(
        request: Promise<T>,
      ): Promise<{ ok: true; data: T } | { ok: false; denied: boolean }> => {
        try {
          return { ok: true, data: await request };
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') throw err;
          return { ok: false, denied: err instanceof ApiError && err.status === 403 };
        }
      };

      try {
        const [yearsR, classesR, subjectsR, divisionsR] = await Promise.all([
          settle(api<{ academicYears: AcademicYear[] }>('/academic/academic-years', { signal })),
          settle(api<{ classes: ClassRow[] }>('/academic/classes', { signal })),
          settle(api<{ subjects: SubjectResponse[] }>('/academic/subjects', { signal })),
          settle(api<{ divisions: DivisionRow[] }>('/academic/divisions', { signal })),
        ]);

        const decision = resolveConsoleLoad(grants, {
          academicYears: yearsR.ok ? 'ok' : 'failed',
          classes: classesR.ok ? 'ok' : 'failed',
          divisions: divisionsR.ok ? 'ok' : 'failed',
          subjects: subjectsR.ok ? 'ok' : subjectsR.denied ? 'denied' : 'failed',
        });
        setSubjectsDenied(decision.subjectsDenied);
        setSubjectsFailed(decision.subjectsFailed);
        if (decision.status === 'error') {
          setState('error');
          return;
        }

        const nextClasses = classesR.ok ? (classesR.data.classes ?? []) : [];
        setYears(yearsR.ok ? (yearsR.data.academicYears ?? []) : []);
        setClasses(nextClasses);
        // Empty here only because the catalogue is unavailable — the sections
        // are told so, so none of them renders it as a genuinely empty one.
        setSubjects(subjectsR.ok ? (subjectsR.data.subjects ?? []) : []);
        setDivisions(divisionsR.ok ? (divisionsR.data.divisions ?? []) : []);

        // Per-class offerings are `academic-structure.read` (the page's own
        // key), so they load whenever the console does; a failure still
        // degrades to empty rather than failing the whole console.
        try {
          const offerings = await Promise.all(
            nextClasses.map(async (klass) => {
              const { subjects: offered } = await api<{ subjects: Offering[] }>(
                `/academic/classes/${klass.id}/subjects`,
                { signal },
              );
              return [klass.id, offered ?? []] as const;
            }),
          );
          setOfferedByClass(Object.fromEntries(offerings));
        } catch {
          setOfferedByClass({});
        }
        setState('ready');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState('error');
      }
    },
    [grants],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic Structure"
        description="Configure the institute's academic year, class, subject offering, and division model. Class and division deletes are permanent and cascade student placements — they require explicit confirmation."
      />

      {state === 'loading' ? (
        <SkeletonRows rows={6} />
      ) : state === 'error' ? (
        <ErrorState onRetry={() => void load()} />
      ) : (
        <Tabs defaultValue="years">
          <TabsList>
            <TabsTrigger value="years">
              <CalendarDays /> Academic Years
            </TabsTrigger>
            <TabsTrigger value="classes">
              <GraduationCap /> Classes
            </TabsTrigger>
            <TabsTrigger value="divisions">
              <Layers /> Divisions
            </TabsTrigger>
            {canReadAssignments && (
              <TabsTrigger value="assignments">
                <UserRoundCheck /> Teacher Assignments
              </TabsTrigger>
            )}
            {canReadAssignments && (
              <TabsTrigger value="placements">
                <Users /> Student Placements
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="years" className="pt-4">
            <AcademicYearsSection
              years={years}
              canCreate={canCreateStructure}
              canUpdate={canUpdateStructure}
              onChange={() => void load()}
            />
          </TabsContent>
          <TabsContent value="classes" className="pt-4">
            <ClassesSection
              classes={[...classes].sort(bySortOrder)}
              divisions={divisions}
              subjects={subjects}
              offeredByClass={offeredByClass}
              subjectsDenied={subjectsDenied}
              subjectsFailed={subjectsFailed}
              canCreate={canCreateStructure}
              canUpdate={canUpdateStructure}
              canDelete={canDeleteStructure}
              onChange={() => void load()}
            />
          </TabsContent>
          <TabsContent value="divisions" className="pt-4">
            <DivisionsSection
              divisions={divisions}
              years={[...years].sort(bySortOrder)}
              classes={[...classes].sort(bySortOrder)}
              canCreate={canCreateStructure}
              canUpdate={canUpdateStructure}
              canDelete={canDeleteStructure}
              onChange={() => void load()}
            />
          </TabsContent>
          <TabsContent value="assignments" className="pt-4">
            <TeacherAssignmentsSection
              classes={[...classes].sort(bySortOrder)}
              offeredByClass={offeredByClass}
              canCreate={canCreateAssignments}
              canDelete={canDeleteAssignments}
              onChange={() => void load()}
            />
          </TabsContent>
          <TabsContent value="placements" className="pt-4">
            <StudentPlacementsSection
              classes={[...classes].sort(bySortOrder)}
              divisions={divisions}
              years={[...years].sort(bySortOrder)}
              subjects={subjects}
              offeredByClass={offeredByClass}
              subjectsDenied={subjectsDenied}
              subjectsFailed={subjectsFailed}
              canCreate={canCreateAssignments}
              canDelete={canDeleteAssignments}
              canTransfer={canTransferPlacements}
              onChange={() => void load()}
            />
          </TabsContent>
        </Tabs>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <School className="size-3.5" />
        Every section needs its own read permission — academic years, classes and divisions need{' '}
        <code>academic-structure.read</code>, the subject catalogue needs <code>subjects.read</code>
        , assignments and placements need <code>assignments.read</code>. A section your role cannot
        read is marked unavailable, never shown as empty. Management actions need the matching write
        key; the backend authorizes every write.
      </p>
    </div>
  );
}
