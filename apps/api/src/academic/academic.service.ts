import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import { subjects, chapters, topics } from '@catlium/database';
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
      .where(eq(subjects.instituteId, instituteId))
      .orderBy(asc(subjects.sortOrder), asc(subjects.name));

    return rows;
  }

  async getSubject(instituteId: string, subjectId: string) {
    const [subject] = await this.db
      .select()
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
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

  // ── Chapters ─────────────────────────────

  async listChapters(instituteId: string, subjectId: string) {
    await this.getSubject(instituteId, subjectId);

    return this.db
      .select()
      .from(chapters)
      .where(eq(chapters.subjectId, subjectId))
      .orderBy(asc(chapters.sortOrder), asc(chapters.name));
  }

  async getChapter(instituteId: string, chapterId: string) {
    const [chapter] = await this.db
      .select({ chapter: chapters })
      .from(chapters)
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(chapters.id, chapterId), eq(subjects.instituteId, instituteId)))
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
      .where(eq(topics.chapterId, chapterId))
      .orderBy(asc(topics.sortOrder), asc(topics.name));
  }

  async getTopic(instituteId: string, topicId: string) {
    const [topic] = await this.db
      .select({ topic: topics })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(topics.id, topicId), eq(subjects.instituteId, instituteId)))
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
