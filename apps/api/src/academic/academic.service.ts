import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, asc, count, desc, inArray, isNull, isNotNull } from 'drizzle-orm';
import {
  subjects,
  chapters,
  topics,
  questions,
  materials,
  contentItems,
  syllabi,
  paperPatternSubjects,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';

interface SubjectInput {
  name: string;
  slug: string;
  description?: string;
  sortOrder?: number;
}

interface ChapterInput {
  name: string;
  slug: string;
  description?: string;
  sortOrder?: number;
}

interface TopicInput {
  name: string;
  slug: string;
  description?: string;
  sortOrder?: number;
}

type SubjectPatch = Partial<SubjectInput> & { status?: 'active' | 'archived' };
type ChapterPatch = Partial<ChapterInput> & { status?: 'active' | 'archived' };
type TopicPatch = Partial<TopicInput> & { status?: 'active' | 'archived' };

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class AcademicService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  // ── Subjects ─────────────────────────────

  async listSubjects(instituteId: string) {
    const rows = await this.db
      .select()
      .from(subjects)
      .where(and(eq(subjects.instituteId, instituteId), isNull(subjects.deletedAt)))
      .orderBy(asc(subjects.sortOrder), asc(subjects.name));

    return rows;
  }

  /** Soft-deleted subjects (the trash). */
  async listDeletedSubjects(instituteId: string) {
    const rows = await this.db
      .select()
      .from(subjects)
      .where(and(eq(subjects.instituteId, instituteId), isNotNull(subjects.deletedAt)))
      .orderBy(desc(subjects.deletedAt));

    return rows;
  }

  async getSubject(instituteId: string, subjectId: string) {
    const [subject] = await this.db
      .select()
      .from(subjects)
      .where(
        and(
          eq(subjects.id, subjectId),
          eq(subjects.instituteId, instituteId),
          isNull(subjects.deletedAt),
        ),
      )
      .limit(1);

    if (!subject) {
      throw new NotFoundException('Subject not found');
    }

    return subject;
  }

  async createSubject(instituteId: string, input: SubjectInput) {
    try {
      const [subject] = await this.db
        .insert(subjects)
        .values({ ...input, instituteId })
        .returning();

      return subject!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'A subject with this slug already exists');
      throw error;
    }
  }

  async updateSubject(instituteId: string, subjectId: string, patch: SubjectPatch) {
    await this.getSubject(instituteId, subjectId);

    try {
      const [subject] = await this.db
        .update(subjects)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
        .returning();

      return subject!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'A subject with this slug already exists');
      throw error;
    }
  }

  /** Soft-deletes a subject and its whole tree — chapters, topics, questions,
   *  materials, content items and syllabi under it — in one transaction. Every
   *  row is flagged deleted_at, never removed, so a careless delete is
   *  reversible with restoreSubject. */
  async deleteSubject(instituteId: string, subjectId: string) {
    await this.getSubject(instituteId, subjectId);

    await this.db.transaction(async (tx) => {
      const chapterIds = (
        await tx
          .select({ id: chapters.id })
          .from(chapters)
          .where(and(eq(chapters.subjectId, subjectId), isNull(chapters.deletedAt)))
      ).map((c) => c.id);

      const [subj] = await tx
        .update(subjects)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
        .returning();
      if (!subj) throw new NotFoundException('Subject not found');

      if (chapterIds.length > 0) {
        await tx
          .update(chapters)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(inArray(chapters.id, chapterIds), isNull(chapters.deletedAt)),
          );
        await tx
          .update(topics)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(inArray(topics.chapterId, chapterIds), isNull(topics.deletedAt)),
          );
      }
    });

    await this.markSubjectIdDependentsDeleted(instituteId, subjectId);
    return { deleted: true };
  }

  /** Reverses deleteSubject: clears deleted_at on the subject and every row
   *  that was soft-deleted with it. */
  async restoreSubject(instituteId: string, subjectId: string) {
    await this.getDeletedSubject(instituteId, subjectId);

    await this.db.transaction(async (tx) => {
      const chapterIds = (
        await tx
          .select({ id: chapters.id })
          .from(chapters)
          .where(eq(chapters.subjectId, subjectId))
      ).map((c) => c.id);

      const [subj] = await tx
        .update(subjects)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
        .returning();
      if (!subj) throw new NotFoundException('Subject not found');

      if (chapterIds.length > 0) {
        await tx
          .update(chapters)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(and(inArray(chapters.id, chapterIds), isNotNull(chapters.deletedAt)));
        await tx
          .update(topics)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(and(inArray(topics.chapterId, chapterIds), isNotNull(topics.deletedAt)));
      }
    });

    await this.markSubjectIdDependentsRestored(instituteId, subjectId);
    return { restored: true };
  }

  private async markSubjectIdDependentsDeleted(instituteId: string, subjectId: string) {
    await this.db
      .update(questions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(questions.subjectId, subjectId),
          eq(questions.instituteId, instituteId),
          isNull(questions.deletedAt),
        ),
      );
    await this.db
      .update(materials)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(materials.subjectId, subjectId),
          eq(materials.instituteId, instituteId),
          isNull(materials.deletedAt),
        ),
      );
    await this.db
      .update(contentItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(contentItems.subjectId, subjectId),
          eq(contentItems.instituteId, instituteId),
          isNull(contentItems.deletedAt),
        ),
      );
    await this.db
      .update(syllabi)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(syllabi.subjectId, subjectId),
          eq(syllabi.instituteId, instituteId),
          isNull(syllabi.deletedAt),
        ),
      );
  }

  private async markSubjectIdDependentsRestored(instituteId: string, subjectId: string) {
    await this.db
      .update(questions)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(questions.subjectId, subjectId),
          eq(questions.instituteId, instituteId),
          isNotNull(questions.deletedAt),
        ),
      );
    await this.db
      .update(materials)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(materials.subjectId, subjectId),
          eq(materials.instituteId, instituteId),
          isNotNull(materials.deletedAt),
        ),
      );
    await this.db
      .update(contentItems)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(contentItems.subjectId, subjectId),
          eq(contentItems.instituteId, instituteId),
          isNotNull(contentItems.deletedAt),
        ),
      );
    await this.db
      .update(syllabi)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(syllabi.subjectId, subjectId),
          eq(syllabi.instituteId, instituteId),
          isNotNull(syllabi.deletedAt),
        ),
      );
  }

  private async getDeletedSubject(instituteId: string, subjectId: string) {
    const [subject] = await this.db
      .select()
      .from(subjects)
      .where(
        and(
          eq(subjects.id, subjectId),
          eq(subjects.instituteId, instituteId),
          isNotNull(subjects.deletedAt),
        ),
      )
      .limit(1);
    if (!subject) throw new NotFoundException('Subject is not in the trash');
    return subject;
  }

  /** Human-readable summary of everything under a subject (used by the
   *  delete/restore confirmation dialogs). */
  async subjectDependents(instituteId: string, subjectId: string): Promise<string[]> {
    const base = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
      .limit(1);
    if (!base[0]) throw new NotFoundException('Subject not found');
    const counts = await Promise.all([
      this.db.select({ n: count() }).from(chapters).where(eq(chapters.subjectId, subjectId)),
      this.db.select({ n: count() }).from(questions).where(eq(questions.subjectId, subjectId)),
      this.db.select({ n: count() }).from(materials).where(eq(materials.subjectId, subjectId)),
      this.db
        .select({ n: count() })
        .from(contentItems)
        .where(eq(contentItems.subjectId, subjectId)),
      this.db.select({ n: count() }).from(syllabi).where(eq(syllabi.subjectId, subjectId)),
      this.db
        .select({ n: count() })
        .from(paperPatternSubjects)
        .where(eq(paperPatternSubjects.subjectId, subjectId)),
    ]);
    const labels: [string, string][] = [
      ['chapter', 'chapters'],
      ['question', 'questions'],
      ['material', 'materials'],
      ['content item', 'content items'],
      ['syllabus', 'syllabi'],
      ['paper-pattern link', 'paper-pattern links'],
    ];
    const dependents: string[] = [];
    counts.forEach(([{ n }], i) => {
      if (n > 0) dependents.push(`${n} ${n === 1 ? labels[i]![0] : labels[i]![1]}`);
    });
    return dependents;
  }

  // ── Chapters ─────────────────────────────

  async listChapters(instituteId: string, subjectId: string) {
    await this.getSubject(instituteId, subjectId);

    return this.db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.subjectId, subjectId),
          eq(chapters.status, 'active'),
          isNull(chapters.deletedAt),
        ),
      )
      .orderBy(asc(chapters.sortOrder), asc(chapters.name));
  }

  async getChapter(instituteId: string, chapterId: string) {
    const [chapter] = await this.db
      .select({ chapter: chapters })
      .from(chapters)
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(
        and(
          eq(chapters.id, chapterId),
          eq(subjects.instituteId, instituteId),
          isNull(subjects.deletedAt),
          isNull(chapters.deletedAt),
        ),
      )
      .limit(1);

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    return chapter.chapter;
  }

  async createChapter(instituteId: string, subjectId: string, input: ChapterInput) {
    await this.getSubject(instituteId, subjectId);

    try {
      const [chapter] = await this.db
        .insert(chapters)
        .values({ ...input, subjectId })
        .returning();

      return chapter!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'A chapter with this slug already exists in the subject');
      throw error;
    }
  }

  async updateChapter(instituteId: string, chapterId: string, patch: ChapterPatch) {
    await this.getChapter(instituteId, chapterId);

    try {
      const [chapter] = await this.db
        .update(chapters)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(chapters.id, chapterId))
        .returning();

      return chapter!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'A chapter with this slug already exists in the subject');
      throw error;
    }
  }

  // ── Topics ───────────────────────────────

  async listTopics(instituteId: string, chapterId: string) {
    await this.getChapter(instituteId, chapterId);

    return this.db
      .select()
      .from(topics)
      .where(
        and(eq(topics.chapterId, chapterId), eq(topics.status, 'active'), isNull(topics.deletedAt)),
      )
      .orderBy(asc(topics.sortOrder), asc(topics.name));
  }

  async getTopic(instituteId: string, topicId: string) {
    const [topic] = await this.db
      .select({ topic: topics })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(
        and(
          eq(topics.id, topicId),
          eq(subjects.instituteId, instituteId),
          isNull(subjects.deletedAt),
          isNull(chapters.deletedAt),
          isNull(topics.deletedAt),
        ),
      )
      .limit(1);

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    return topic.topic;
  }

  async createTopic(instituteId: string, chapterId: string, input: TopicInput) {
    await this.getChapter(instituteId, chapterId);

    try {
      const [topic] = await this.db
        .insert(topics)
        .values({ ...input, chapterId })
        .returning();

      return topic!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'A topic with this slug already exists in the chapter');
      throw error;
    }
  }

  async updateTopic(instituteId: string, topicId: string, patch: TopicPatch) {
    await this.getTopic(instituteId, topicId);

    try {
      const [topic] = await this.db
        .update(topics)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(topics.id, topicId))
        .returning();

      return topic!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'A topic with this slug already exists in the chapter');
      throw error;
    }
  }

  private throwIfUniqueViolation(error: unknown, message: string): void {
    const code =
      typeof error === 'object' && error !== null && 'cause' in error
        ? (error.cause as { code?: string })?.code
        : (error as { code?: string })?.code;

    if (code === UNIQUE_VIOLATION) {
      throw new ConflictException(message);
    }
  }
}
