import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';
import { institutes, subjects, syllabi, chapters, topics, users } from '@catlium/database';

import { SyllabusService } from './syllabus.service.ts';
import type { JobsService } from '../jobs/jobs.service.ts';
import type { StorageProvider } from '../materials/storage/storage-provider.interface.ts';
import type { AcademicScopeService } from '../authorization/academic-scope.service.ts';

// B1 regression — syllabus confirmation must PERSIST the chapter → topic rows
// of the analyzed structure into the real academic hierarchy, keep reused
// chapters active across re-confirms (usedChapterIds consumption), and archive
// the topics of chapters the new structure removed (no orphaned active topics).
// Requires a live database: run with TEST_DATABASE_URL=postgresql://... ; skips
// when unset. Scratch data lives under a unique institute and is removed after.

const testDbUrl = process.env.TEST_DATABASE_URL ?? null;
const db = testDbUrl ? createDatabase(testDbUrl) : null;

after(async () => {
  await (db as unknown as { $client?: { end: () => Promise<void> } } | null)?.$client?.end?.();
});

const skip = testDbUrl ? false : 'TEST_DATABASE_URL not set';

function buildService(svc: Database): SyllabusService {
  const jobsStub = {} as unknown as JobsService;
  const storageStub = {
    save: async () => undefined,
    delete: async () => undefined,
  } as unknown as StorageProvider;
  const scopeStub = {
    requireWritableSubject: async () => undefined,
    requireReadableSubject: async () => undefined,
    subjectScopePredicate: async () => null,
  } as unknown as AcademicScopeService;
  return new SyllabusService(svc, jobsStub, storageStub, scopeStub);
}

test('syllabus confirm persists topic rows; re-confirm keeps reused chapters and archives removed topics', { skip }, async () => {
  const svc = db as unknown as Database;
  const service = buildService(svc);
  const suffix = randomUUID().slice(0, 8);

  const [inst] = await svc
    .insert(institutes)
    .values({ name: `b1-${suffix}`, slug: `b1-${suffix}` })
    .returning();
  const [user] = await svc
    .insert(users)
    .values({ email: `b1-${suffix}@example.test`, name: 'B1', passwordHash: 'x' })
    .returning();
  const [subject] = await svc
    .insert(subjects)
    .values({ instituteId: inst!.id, name: 'B1 Subject', slug: `b1subj-${suffix}` })
    .returning();

  try {
    const [syllabusRow] = await svc
      .insert(syllabi)
      .values({
        instituteId: inst!.id,
        subjectId: subject!.id,
        version: 1,
        title: 'B1 Syllabus',
        sourceType: 'TEXT',
        textContent: 'scratch text',
        processingStatus: 'READY',
        analysisStatus: 'READY',
        status: 'PROPOSED',
        structure: {
          chapters: [
            { name: 'Foundations', topics: [{ name: 'Introduction' }] },
            { name: 'Advanced', topics: [{ name: 'Deep Dive' }] },
          ],
        },
        createdBy: user!.id,
      })
      .returning();

    const confirmed = await service.confirmSyllabus(inst!.id, 'membership-b1', user!.id, syllabusRow!.id);
    assert.equal(confirmed.report.createdChapters.length, 2);
    assert.equal(confirmed.report.createdTopics.length, 2);
    assert.equal(confirmed.syllabus.status, 'CONFIRMED');

    const chapterRows = await svc
      .select()
      .from(chapters)
      .where(and(eq(chapters.subjectId, subject!.id), isNull(chapters.deletedAt)))
      .orderBy(chapters.sortOrder);
    assert.deepEqual(
      chapterRows.map((c) => c.name),
      ['Foundations', 'Advanced'],
    );
    assert.ok(chapterRows.every((c) => c.status === 'active'));

    // The regression under test: confirmation PERSISTS topic rows.
    const topicRows = await svc
      .select()
      .from(topics)
      .where(eq(topics.chapterId, chapterRows[0]!.id));
    assert.deepEqual(
      topicRows.map((t) => t.name),
      ['Introduction'],
    );
    assert.equal(topicRows[0]!.status, 'active');

    // Re-confirm with an edited structure: 'Foundations' is reused (must stay
    // active — usedChapterIds consumption), 'Advanced' is removed (chapter AND
    // its topic must be archived), 'Replacement' is new.
    await service.setLocked(inst!.id, 'membership-b1', user!.id, syllabusRow!.id, false);
    await service.updateSyllabus(inst!.id, 'membership-b1', user!.id, syllabusRow!.id, {
      structure: {
        chapters: [
          {
            name: 'Foundations',
            topics: [{ name: 'Introduction' }, { name: 'Extra' }],
          },
          { name: 'Replacement', topics: [{ name: 'New Topic' }] },
        ],
      },
    });

    const reconfirmed = await service.confirmSyllabus(inst!.id, 'membership-b1', user!.id, syllabusRow!.id);
    assert.equal(reconfirmed.report.reusedChapters.length, 1);
    assert.equal(reconfirmed.report.removedChapters.length, 1);
    assert.ok(reconfirmed.report.removedTopics.length >= 1);

    const afterRows = await svc
      .select()
      .from(chapters)
      .where(and(eq(chapters.subjectId, subject!.id), isNull(chapters.deletedAt)))
      .orderBy(chapters.sortOrder);
    const byName = new Map(afterRows.map((c) => [c.name, c]));
    assert.equal(byName.get('Foundations')!.id, chapterRows[0]!.id, 'reused chapter identity preserved');
    assert.equal(byName.get('Foundations')!.status, 'active', 'reused chapter stays active');
    assert.equal(byName.get('Advanced')!.status, 'archived', 'removed chapter archived');
    assert.equal(byName.get('Replacement')!.status, 'active');

    const advancedTopics = await svc
      .select()
      .from(topics)
      .where(eq(topics.chapterId, byName.get('Advanced')!.id));
    assert.ok(advancedTopics.length >= 1);
    assert.ok(
      advancedTopics.every((t) => t.status === 'archived'),
      'topics of an archived chapter are archived, never left active',
    );

    const foundationsTopics = await svc
      .select()
      .from(topics)
      .where(eq(topics.chapterId, byName.get('Foundations')!.id));
    assert.deepEqual(
      foundationsTopics.map((t) => t.name).sort(),
      ['Extra', 'Introduction'],
    );
    assert.ok(foundationsTopics.every((t) => t.status === 'active'));
  } finally {
    await svc.delete(syllabi).where(eq(syllabi.instituteId, inst!.id));
    await svc.delete(subjects).where(eq(subjects.instituteId, inst!.id));
    await svc.delete(users).where(eq(users.id, user!.id));
    await svc.delete(institutes).where(eq(institutes.id, inst!.id));
  }
});
