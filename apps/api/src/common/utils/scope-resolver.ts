import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Database } from '@catlium/database';
import { chapters, subjects, topics } from '@catlium/database';

export interface ScopeInput {
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

export interface ScopeChain {
  subjectId: string | null;
  chapterId: string | null;
  topicId: string | null;
}

export interface ScopeResolveOptions {
  db: Database;
  instituteId: string;
  /** Materials require a subject; content/questions may be unscoped. */
  requireSubject: boolean;
}

/** Resolve an academic scope to its full chain (topic -> chapter -> subject),
 * validating every provided reference belongs to the institute and that the
 * chain is consistent with the scope_chain DB checks. */
export async function resolveScopeChain(
  options: ScopeResolveOptions,
  input: ScopeInput,
): Promise<ScopeChain> {
  const { db, instituteId, requireSubject } = options;

  if (input.topicId !== undefined) {
    const [topic] = await db
      .select({
        topicId: topics.id,
        chapterId: chapters.id,
        subjectId: subjects.id,
      })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(topics.id, input.topicId), eq(subjects.instituteId, instituteId)))
      .limit(1);
    if (!topic) throw new NotFoundException('Topic not found');
    if (input.chapterId !== undefined && input.chapterId !== topic.chapterId) {
      throw new BadRequestException('chapterId does not match topicId');
    }
    if (input.subjectId !== undefined && input.subjectId !== topic.subjectId) {
      throw new BadRequestException('subjectId does not match topicId');
    }
    return { subjectId: topic.subjectId, chapterId: topic.chapterId, topicId: topic.topicId };
  }

  if (input.chapterId !== undefined) {
    const [chapter] = await db
      .select({ chapterId: chapters.id, subjectId: subjects.id })
      .from(chapters)
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(chapters.id, input.chapterId), eq(subjects.instituteId, instituteId)))
      .limit(1);
    if (!chapter) throw new NotFoundException('Chapter not found');
    if (input.subjectId !== undefined && input.subjectId !== chapter.subjectId) {
      throw new BadRequestException('subjectId does not match chapterId');
    }
    return { subjectId: chapter.subjectId, chapterId: chapter.chapterId, topicId: null };
  }

  if (input.subjectId !== undefined) {
    const [subject] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, input.subjectId), eq(subjects.instituteId, instituteId)))
      .limit(1);
    if (!subject) throw new NotFoundException('Subject not found');
    return { subjectId: subject.id, chapterId: null, topicId: null };
  }

  if (requireSubject) {
    throw new BadRequestException('subjectId is required');
  }
  return { subjectId: null, chapterId: null, topicId: null };
}