'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, GraduationCap, Layers, School } from 'lucide-react';

import { api } from '@/lib/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTenant } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { SkeletonRows } from '@/components/app/loading';
import { ErrorState } from '@/components/app/error-state';
import {
  canWriteAcademicStructure,
  bySortOrder,
  type AcademicYear,
  type ClassRow,
  type DivisionRow,
} from '@/lib/academic';
import type { SubjectResponse } from '@catlium/contracts';

import { AcademicYearsSection } from './academic-years-section';
import { ClassesSection } from './classes-section';
import { DivisionsSection } from './divisions-section';

export default function AcademicConsolePage() {
  const { institute } = useTenant();
  const admin = canWriteAcademicStructure(institute);

  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [offeredByClass, setOfferedByClass] = useState<Record<string, SubjectResponse[]>>({});
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');

  const load = useCallback(async (signal?: AbortSignal) => {
    setState('loading');
    try {
      const [yearsData, classesData, subjectsData, divisionsData] = await Promise.all([
        api<{ academicYears: AcademicYear[] }>('/academic/academic-years', { signal }),
        api<{ classes: ClassRow[] }>('/academic/classes', { signal }),
        api<{ subjects: SubjectResponse[] }>('/academic/subjects', { signal }),
        api<{ divisions: DivisionRow[] }>('/academic/divisions', { signal }),
      ]);
      const nextClasses = classesData.classes ?? [];
      setYears(yearsData.academicYears ?? []);
      setClasses(nextClasses);
      setSubjects(subjectsData.subjects ?? []);
      setDivisions(divisionsData.divisions ?? []);

      // Per-class offerings drive the table's subject column and the delete
      // confirm's exact impact. Reads are open to members, so a failure here
      // degrades to empty instead of failing the whole console.
      try {
        const offerings = await Promise.all(
          nextClasses.map(async (klass) => {
            const { subjects: offered } = await api<{ subjects: SubjectResponse[] }>(
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
  }, []);

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
          </TabsList>
          <TabsContent value="years" className="pt-4">
            <AcademicYearsSection years={years} admin={admin} onChange={() => void load()} />
          </TabsContent>
          <TabsContent value="classes" className="pt-4">
            <ClassesSection
              classes={[...classes].sort(bySortOrder)}
              divisions={divisions}
              subjects={subjects}
              offeredByClass={offeredByClass}
              admin={admin}
              onChange={() => void load()}
            />
          </TabsContent>
          <TabsContent value="divisions" className="pt-4">
            <DivisionsSection
              divisions={divisions}
              years={[...years].sort(bySortOrder)}
              classes={[...classes].sort(bySortOrder)}
              admin={admin}
              onChange={() => void load()}
            />
          </TabsContent>
        </Tabs>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <School className="size-3.5" />
        Reads are available to every institute member; management actions are
        reserved for institute admins (the backend authorizes every write).
      </p>
    </div>
  );
}