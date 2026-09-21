import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { eq, and, inArray } from 'drizzle-orm';

import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  institutes,
  academicYears,
  classes,
  divisions,
  subjects,
  classSubjects,
  studentPlacements,
  teacherAssignments,
  studentSubjectEnrollments,
  materials,
  contentItems,
  users,
  memberships,
  membershipRoles,
  roles,
} from '@catlium/database';

import { AcademicScopeService } from './academic-scope.service.ts';
import { StudentSubjectEnrollmentsService } from '../academic-structure/student-enrollments.service.ts';
import { MaterialsService } from '../materials/materials.service.ts';
import type { StorageProvider } from '../materials/storage/storage-provider.interface.js';
import type { UploadChunksService } from '../materials/upload-chunks.service.js';
import type { JobsService } from '../jobs/jobs.service.js';
import type { OcrCoordinatorService } from '../ocr/ocr-coordinator.service.js';
import type { MaterialEnhancementService } from '../material-enhancement/enhancement.service.js';

// Phase H integration test (D6/§18 academic scope). Requires a live database:
// run with TEST_DATABASE_URL=postgresql://... (see .env). Skips cleanly when
// unset so the default `pnpm test` run needs no database. Scratch data is
// created under unique slugs/names and removed afterwards. Role seeds
// (INSTITUTE_ADMIN/STUDENT/TEACHER) come from migration 0039.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

test('academic scope: student/teacher/admin subject sets, overrides, enforcement on materials', {
  skip: testDbUrl ? false : 'TEST_DATABASE_URL not set',
}, async () => {
  const svc = db as unknown as Database;
  const scope = new AcademicScopeService(svc);
  const enrollmentsSvc = new StudentSubjectEnrollmentsService(svc);

  const storageStub = { save: async () => undefined, delete: async () => undefined } as unknown as StorageProvider;
  const chunksStub = {} as unknown as UploadChunksService;
  const jobsStub = { latestMaterialJob: async () => null } as unknown as JobsService;
  const ocrStub = {} as unknown as OcrCoordinatorService;
  const enhStub = { requestEnhancement: async () => undefined } as unknown as MaterialEnhancementService;
  const materialsSvc = new MaterialsService(svc, storageStub, chunksStub, jobsStub, ocrStub, enhStub, scope);

  const scratchInstituteIds: string[] = [];
  const scratchUserIds: string[] = [];

  try {
    const [instA] = await db!.insert(institutes).values({ name: randomUUID(), slug: `ph-a-${randomUUID()}` }).returning();
    scratchInstituteIds.push(instA.id);
    const [instB] = await db!.insert(institutes).values({ name: randomUUID(), slug: `ph-b-${randomUUID()}` }).returning();
    scratchInstituteIds.push(instB.id);

    const [yearA] = await db!.insert(academicYears).values({ instituteId: instA.id, name: 'Phase H Year' }).returning();
    const [yearB] = await db!.insert(academicYears).values({ instituteId: instB.id, name: 'Phase H Year B' }).returning();

    const [class1] = await db!.insert(classes).values({ instituteId: instA.id, name: 'Phase H Class 1' }).returning();
    const [class2] = await db!.insert(classes).values({ instituteId: instA.id, name: 'Phase H Class 2' }).returning();
    const [classB] = await db!.insert(classes).values({ instituteId: instB.id, name: 'Phase H Class B' }).returning();

    const subj = async (instituteId: string, name: string) => {
      const [s] = await db!.insert(subjects).values({ instituteId, name, slug: randomUUID() }).returning();
      return s.id;
    };
    const s1 = await subj(instA.id, 'Subject 1');
    const s2 = await subj(instA.id, 'Subject 2');
    const s3 = await subj(instA.id, 'Subject 3');
    const sB = await subj(instB.id, 'Subject B');

    const [off1] = await db!.insert(classSubjects).values({ classId: class1.id, subjectId: s1 }).returning();
    await db!.insert(classSubjects).values({ classId: class1.id, subjectId: s2 }).returning();
    await db!.insert(classSubjects).values({ classId: class2.id, subjectId: s3 }).returning();
    const [offB] = await db!.insert(classSubjects).values({ classId: classB.id, subjectId: sB }).returning();

    const [div1A] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: yearA.id, classId: class1.id, name: 'A' }).returning();
    const [div1B] = await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: yearA.id, classId: class1.id, name: 'B' }).returning();
    await db!.insert(divisions).values({ instituteId: instA.id, academicYearId: yearA.id, classId: class2.id, name: 'A' }).returning();
    const [divB] = await db!.insert(divisions).values({ instituteId: instB.id, academicYearId: yearB.id, classId: classB.id, name: 'A' }).returning();

    const roleId = async (key: string) => {
      const [r] = await db!.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
      if (!r) throw new Error(`${key} role not seeded`);
      return r.id;
    };

    const member = async (instituteId: string, name: string, roleKey: string) => {
      const [user] = await db!.insert(users).values({ email: randomUUID(), name, passwordHash: 'x' }).returning();
      scratchUserIds.push(user.id);
      const [m] = await db!.insert(memberships).values({ userId: user.id, instituteId, status: 'active' }).returning();
      await db!.insert(membershipRoles).values({ membershipId: m.id, roleId: await roleId(roleKey) });
      return { userId: user.id, membershipId: m.id };
    };

    const studentA = (await member(instA.id, 'Student A', 'STUDENT')).membershipId;
    const studentA2 = (await member(instA.id, 'Student A Div B', 'STUDENT')).membershipId;
    const studentB = (await member(instB.id, 'Student B', 'STUDENT')).membershipId;
    const teacher1Record = await member(instA.id, 'Teacher 1', 'TEACHER');
    const teacher1 = teacher1Record.membershipId;
    const teacher1U = teacher1Record.userId;
    const teacher2 = (await member(instA.id, 'Teacher 2', 'TEACHER')).membershipId;
    const adminA = await member(instA.id, 'Admin A', 'INSTITUTE_ADMIN');

    const materialOf = async (instituteId: string, subjectId: string, title: string) => {
      const [m] = await db!.insert(materials).values({
        instituteId,
        subjectId,
        title,
        sourceType: 'TEXT',
        textContent: 'x',
        materialType: 'TEXT',
        processingStatus: 'READY',
        status: 'ACTIVE',
        createdBy: adminA.userId,
      }).returning();
      return m!;
    };
    const mS1 = await materialOf(instA.id, s1, 'm_s1');
    const mS2 = await materialOf(instA.id, s2, 'm_s2');
    const mS3 = await materialOf(instA.id, s3, 'm_s3');
    const mB = await materialOf(instB.id, sB, 'm_instB');

    // ── Placements / assignments ─────────────────────────────

    const place = async (instituteId: string, membershipId: string, divisionId: string, academicYearId: string) => {
      const [row] = await db!.insert(studentPlacements).values({
        instituteId, membershipId, academicYearId, divisionId,
      }).returning();
      return row!;
    };
    const placementA = await place(instA.id, studentA, div1A.id, yearA.id);
    await place(instA.id, studentA2, div1B.id, yearA.id);
    const placementB = await place(instB.id, studentB, divB.id, yearB.id);

    await db!.insert(teacherAssignments).values({ instituteId: instA.id, classSubjectId: off1.id, membershipId: teacher1 }).returning();
    await db!.insert(teacherAssignments).values({ instituteId: instA.id, classSubjectId: off1.id, membershipId: teacher2 }).returning();
    await db!.insert(teacherAssignments).values({ instituteId: instB.id, classSubjectId: offB.id, membershipId: teacher1 }).returning();

    // ── Student scope: class subjects, shared across divisions ──

    assert.deepEqual(await scope.resolveScope(instA.id, studentA), { kind: 'subject-set', subjectIds: [s1, s2] });
    // Division B of the same class → identical scope (§18.1 class-level sharing)
    assert.deepEqual(await scope.resolveScope(instA.id, studentA2), { kind: 'subject-set', subjectIds: [s1, s2] });

    // ── List enforcement: student sees only their class's subjects ──

    const studentList = await materialsSvc.listMaterials(instA.id, studentA, {});
    assert.deepEqual(studentList.map((m) => m.id).sort(), [mS1.id, mS2.id].sort());

    // Same predicate powers content reads: scoped rows only, null-subject
    // (admin-only) content excluded from a non-admin's set.
    const contentPred = await scope.subjectScopePredicate(instA.id, studentA, contentItems.subjectId);
    const [cS1] = await db!.insert(contentItems).values({ instituteId: instA.id, subjectId: s1, type: 'NOTE', title: 'c_s1', source: 'MANUAL', currentVersion: 1, createdBy: adminA.userId, updatedBy: adminA.userId }).returning();
    await db!.insert(contentItems).values({ instituteId: instA.id, subjectId: null, type: 'NOTE', title: 'c_null', source: 'MANUAL', currentVersion: 1, createdBy: adminA.userId, updatedBy: adminA.userId }).returning();
    const contentRows = await db!.select({ id: contentItems.id }).from(contentItems).where(and(eq(contentItems.instituteId, instA.id), contentPred!));
    assert.deepEqual(contentRows.map((r) => r.id), [cS1.id]);

    // Single read: in-scope ok, out-of-scope 404 (no existence leak)
    assert.equal((await materialsSvc.getMaterial(instA.id, studentA, mS1.id)).id, mS1.id);
    await assert.rejects(materialsSvc.getMaterial(instA.id, studentA, mS3.id), NotFoundException);

    // ── Cross-tenant: instA view can never reach instB resources ──

    await assert.rejects(materialsSvc.getMaterial(instA.id, studentA, mB.id), NotFoundException);

    // ── Enrollment overrides ──────────────────────────

    // EXCLUDED: subject offered by the class, removed from THIS student only
    await enrollmentsSvc.createStudentEnrollment(instA.id, { placementId: placementA.id, subjectId: s2, kind: 'EXCLUDED' });
    assert.deepEqual(await scope.resolveScope(instA.id, studentA), { kind: 'subject-set', subjectIds: [s1] });

    // ENROLLED: elective subject NOT offered by the class
    await enrollmentsSvc.createStudentEnrollment(instA.id, { placementId: placementA.id, subjectId: s3, kind: 'ENROLLED' });
    assert.deepEqual(await scope.resolveScope(instA.id, studentA), { kind: 'subject-set', subjectIds: [s1, s3] });
    const overriddenList = await materialsSvc.listMaterials(instA.id, studentA, {});
    assert.deepEqual(overriddenList.map((m) => m.id).sort(), [mS1.id, mS3.id].sort());

    // Validation: EXCLUDED must be a class subject; ENROLLED must not be one
    await assert.rejects(
      enrollmentsSvc.createStudentEnrollment(instA.id, { placementId: placementA.id, subjectId: s3, kind: 'EXCLUDED' }),
      BadRequestException,
    );
    await assert.rejects(
      enrollmentsSvc.createStudentEnrollment(instA.id, { placementId: placementA.id, subjectId: s2, kind: 'ENROLLED' }),
      BadRequestException,
    );
    // Duplicate (placement, subject) → Conflict
    await assert.rejects(
      enrollmentsSvc.createStudentEnrollment(instA.id, { placementId: placementA.id, subjectId: s3, kind: 'ENROLLED' }),
      ConflictException,
    );
    // Cross-tenant: instB subject / instB placement not reachable from instA
    await assert.rejects(
      enrollmentsSvc.createStudentEnrollment(instA.id, { placementId: placementA.id, subjectId: sB, kind: 'ENROLLED' }),
      NotFoundException,
    );
    await assert.rejects(
      enrollmentsSvc.createStudentEnrollment(instA.id, { placementId: placementB.id, subjectId: s3, kind: 'ENROLLED' }),
      NotFoundException,
    );

    // Removing overrides reverts to the class default
    const [excluded] = await db!.select().from(studentSubjectEnrollments).where(eq(studentSubjectEnrollments.placementId, placementA.id));
    await enrollmentsSvc.removeStudentEnrollment(instA.id, excluded.id);
    const [enrolled] = await db!.select().from(studentSubjectEnrollments).where(eq(studentSubjectEnrollments.kind, 'ENROLLED'));
    await enrollmentsSvc.removeStudentEnrollment(instA.id, enrolled.id);
    assert.deepEqual(await scope.resolveScope(instA.id, studentA), { kind: 'subject-set', subjectIds: [s1, s2] });

    // ── Inactive placement → empty scope → nothing visible ──

    await db!.update(studentPlacements).set({ status: 'inactive', updatedAt: new Date() }).where(eq(studentPlacements.id, placementA.id));
    assert.deepEqual(await scope.resolveScope(instA.id, studentA), { kind: 'subject-set', subjectIds: [] });
    assert.deepEqual(await materialsSvc.listMaterials(instA.id, studentA, {}), []);
    await assert.rejects(materialsSvc.getMaterial(instA.id, studentA, mS1.id), NotFoundException);
    await db!.update(studentPlacements).set({ status: 'active', updatedAt: new Date() }).where(eq(studentPlacements.id, placementA.id));

    // ── Teacher scope ─────────────────────────────

    assert.deepEqual(await scope.resolveScope(instA.id, teacher1), { kind: 'subject-set', subjectIds: [s1] });
    // Co-teacher on the same offering shares the subject
    assert.deepEqual(await scope.resolveScope(instA.id, teacher2), { kind: 'subject-set', subjectIds: [s1] });
    // The instB assignment grants NO scope inside instA
    assert.deepEqual(await scope.resolveScope(instA.id, teacher1), { kind: 'subject-set', subjectIds: [s1] });

    // Reads: in-scope ok, unassigned subject → 404
    assert.equal((await materialsSvc.getMaterial(instA.id, teacher1, mS1.id)).id, mS1.id);
    await assert.rejects(materialsSvc.getMaterial(instA.id, teacher1, mS2.id), NotFoundException);

    // Resource writes: pre-mutation 403 out of scope; allowed in scope
    await assert.rejects(
      materialsSvc.updateMaterial(instA.id, teacher1, teacher1U, mS2.id, { title: 'tamper' }),
      ForbiddenException,
    );
    await assert.rejects(
      materialsSvc.setStatus(instA.id, teacher1, mS2.id, 'ARCHIVED'),
      ForbiddenException,
    );
    await assert.rejects(
      materialsSvc.createTextMaterial(instA.id, teacher1, teacher1U, { title: 't', text: 'x', subjectId: s2 }),
      ForbiddenException,
    );
    const updated = await materialsSvc.updateMaterial(instA.id, teacher1, teacher1U, mS1.id, { title: 'retitled' });
    assert.equal(updated.title, 'retitled');
    // Repointing a resource outside scope → 403
    await assert.rejects(
      materialsSvc.updateMaterial(instA.id, teacher1, teacher1U, mS1.id, { subjectId: s2 }),
      ForbiddenException,
    );

    // Inactive assignment → scope gone
    await db!.update(teacherAssignments).set({ status: 'inactive', updatedAt: new Date() }).where(eq(teacherAssignments.membershipId, teacher1));
    assert.deepEqual(await scope.resolveScope(instA.id, teacher1), { kind: 'subject-set', subjectIds: [] });
    await assert.rejects(materialsSvc.getMaterial(instA.id, teacher1, mS1.id), NotFoundException);

    // ── Admin bypass ─────────────────────────────

    assert.deepEqual(await scope.resolveScope(instA.id, adminA.membershipId), { kind: 'whole-institute' });
    // Null-subject resources are admin-only (non-admin default deny)
    await scope.requireReadableSubject(instA.id, adminA.membershipId, null);
    await assert.rejects(scope.requireReadableSubject(instA.id, studentA, null), NotFoundException);
    await assert.rejects(scope.requireWritableSubject(instA.id, studentA, null), ForbiddenException);
    // Admin sees every subject resource in the institute
    const adminList = await materialsSvc.listMaterials(instA.id, adminA.membershipId, {});
    assert.deepEqual(adminList.map((m) => m.id).sort(), [mS1.id, mS2.id, mS3.id].sort());

    // ── Enrollments service list + remove roundtrip ─────────────────────────
    const created = await enrollmentsSvc.createStudentEnrollment(instA.id, { placementId: placementA.id, subjectId: s3, kind: 'ENROLLED' });
    const listed = await enrollmentsSvc.listStudentEnrollments(instA.id, { placementId: placementA.id });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, created.id);
    await enrollmentsSvc.removeStudentEnrollment(instA.id, created.id);
    assert.deepEqual(await scope.resolveScope(instA.id, studentA), { kind: 'subject-set', subjectIds: [s1, s2] });
  } finally {
    // Clean up scratch data: institutes cascade academic rows + memberships +
    // content/materials (their created_by FKs block a straight user delete,
    // so institutes go first), then leftover users.
    await db!.delete(institutes).where(inArray(institutes.id, scratchInstituteIds));
    await db!.delete(users).where(inArray(users.id, scratchUserIds));
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
  }
});