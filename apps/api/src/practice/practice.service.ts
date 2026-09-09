import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  chapters,
  contentItems,
  contentVersions,
  practiceSessionItems,
  practiceSessionResponses,
  practiceSessions,
  questions,
  subjects,
  topics,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { gradeAnswer } from '../attempts/attempts.grade.js';
import type { PracticeCreateDto, PracticeSaveAnswerDto } from './dto/practice.dto.js';

const countFilteredTrue = sql<number>`count(*) filter (where ${practiceSessionResponses.isCorrect})`;

const IN_PROGRESS = 'IN_PROGRESS';
const COMPLETED = 'COMPLETED';

type ItemRow = typeof practiceSessionItems.$inferSelect;
type ResponseRow = typeof practiceSessionResponses.$inferSelect;

type ResponseValues = {
  answer: unknown;
  rating: 'AGAIN' | 'GOOD' | null;
  isCorrect: boolean | null;
};

/**
 * Phase 13 ungraded practice (PRAC-03: entirely separate from formal
 * examination scoring — no `attempts`, no score records, no analytics).
 * Session items are snapshotted at start; QUESTION answer keys live only in
 * the server-side snapshot and are sanitized from student-facing responses
 * until the student answers that specific item.
 */
@Injectable()
export class PracticeService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  // ── Start ─────────────────────────────────
  async start(instituteId: string, studentId: string, dto: PracticeCreateDto) {
    if (dto.mode === 'FLASHCARD') {
      if (!dto.contentId) throw new BadRequestException('contentId required for flashcard practice');
      if (dto.topicId) throw new BadRequestException('topicId is not valid for flashcard practice');
    } else {
      if (dto.contentId) throw new BadRequestException('contentId is not valid for question practice');
    }

    await this.assertNoOpenSession(instituteId, studentId, dto);

    const items =
      dto.mode === 'FLASHCARD'
        ? await this.flashcardItems(instituteId, dto.contentId!)
        : await this.questionItems(instituteId, dto.topicId);

    const created = await this.db.transaction(async (tx) => {
      const [session] = await tx
        .insert(practiceSessions)
        .values({
          instituteId,
          studentId,
          mode: dto.mode,
          status: IN_PROGRESS,
          contentId: dto.mode === 'FLASHCARD' ? dto.contentId : null,
          topicId: dto.mode === 'QUESTION' ? (dto.topicId ?? null) : null,
        })
        .returning();
      if (items.length > 0) {
        await tx.insert(practiceSessionItems).values(
          items.map((i) => ({ ...i, sessionId: session.id })),
        );
      }
      return session;
    });

    return { session: await this.detail(instituteId, studentId, created.id) };
  }

  // ── History & detail ──────────────────────
  async history(instituteId: string, studentId: string) {
    const sessions = await this.db
      .select()
      .from(practiceSessions)
      .where(and(eq(practiceSessions.instituteId, instituteId), eq(practiceSessions.studentId, studentId)))
      .orderBy(desc(practiceSessions.startedAt));

    const ids = sessions.map((s) => s.id);
    if (ids.length === 0) return { sessions: [] };

    const rows = await this.db
      .select({
        sessionId: practiceSessionItems.sessionId,
        itemCount: count(practiceSessionItems.id),
        answeredCount: count(practiceSessionResponses.id),
        correctCount: countFilteredTrue,
      })
      .from(practiceSessionItems)
      .leftJoin(practiceSessionResponses, eq(practiceSessionResponses.sessionItemId, practiceSessionItems.id))
      .where(inArray(practiceSessionItems.sessionId, ids))
      .groupBy(practiceSessionItems.sessionId);

    const stats = new Map(rows.map((r) => [r.sessionId, r]));
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        mode: s.mode,
        status: s.status,
        itemCount: Number(stats.get(s.id)?.itemCount ?? 0),
        answeredCount: Number(stats.get(s.id)?.answeredCount ?? 0),
        correctCount: Number(stats.get(s.id)?.correctCount ?? 0),
        startedAt: s.startedAt.toISOString(),
        completedAt: s.completedAt?.toISOString() ?? null,
      })),
    };
  }

  async detail(instituteId: string, studentId: string, sessionId: string) {
    const session = await this.loadOwn(instituteId, studentId, sessionId);
    const items = await this.db
      .select()
      .from(practiceSessionItems)
      .where(eq(practiceSessionItems.sessionId, sessionId))
      .orderBy(asc(practiceSessionItems.sortOrder));

    const responses = new Map<string, ResponseRow>();
    if (items.length > 0) {
      const rows = await this.db
        .select()
        .from(practiceSessionResponses)
        .where(inArray(practiceSessionResponses.sessionItemId, items.map((i) => i.id)));
      for (const r of rows) responses.set(r.sessionItemId, r);
    }

    const serialized = items.map((i) => this.serializeItem(i, responses.get(i.id)));
    return {
      id: session.id,
      mode: session.mode,
      status: session.status,
      itemCount: serialized.length,
      answeredCount: serialized.filter((i) => i.answer !== undefined || i.rating !== undefined).length,
      correctCount: serialized.filter((i) => i.isCorrect === true).length,
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
      items: serialized,
    };
  }

  // ── Record answer/rating ──────────────────
  async answer(
    instituteId: string,
    studentId: string,
    sessionId: string,
    sessionItemId: string,
    dto: PracticeSaveAnswerDto,
  ) {
    const session = await this.loadOwn(instituteId, studentId, sessionId);
    if (session.status !== IN_PROGRESS) {
      throw new ConflictException('Practice session is not in progress');
    }

    const [item] = await this.db
      .select()
      .from(practiceSessionItems)
      .where(and(eq(practiceSessionItems.id, sessionItemId), eq(practiceSessionItems.sessionId, sessionId)))
      .limit(1);
    if (!item) throw new NotFoundException('Practice item not found');

    const values =
      session.mode === 'FLASHCARD'
        ? this.flashcardResponse(dto)
        : this.questionResponse(item, dto);

    const [response] = await this.db
      .insert(practiceSessionResponses)
      .values({ ...values, sessionItemId })
      .onConflictDoUpdate({
        target: practiceSessionResponses.sessionItemId,
        set: { answer: values.answer ?? null, rating: values.rating ?? null, isCorrect: values.isCorrect ?? null },
      })
      .returning();

    return { item: this.serializeItem(item, response) };
  }

  // ── Complete ──────────────────────────────
  async complete(instituteId: string, studentId: string, sessionId: string) {
    const session = await this.loadOwn(instituteId, studentId, sessionId);
    if (session.status !== COMPLETED) {
      await this.db
        .update(practiceSessions)
        .set({ status: COMPLETED, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(practiceSessions.id, sessionId));
    }
    return { session: await this.detail(instituteId, studentId, sessionId) };
  }

  // ── Private ───────────────────────────────
  private async assertNoOpenSession(instituteId: string, studentId: string, dto: PracticeCreateDto) {
    const open = await this.db
      .select()
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.instituteId, instituteId),
          eq(practiceSessions.studentId, studentId),
          eq(practiceSessions.mode, dto.mode),
          eq(practiceSessions.status, IN_PROGRESS),
        ),
      );
    const clash = open.find((s) =>
      s.contentId != null
        ? s.contentId === dto.contentId
        : s.topicId === (dto.topicId ?? null),
    );
    if (clash) throw new ConflictException('An open practice session already exists for this source');
  }

  private async flashcardItems(instituteId: string, contentId: string) {
    const [item] = await this.db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, contentId), eq(contentItems.instituteId, instituteId)))
      .limit(1);
    if (!item || item.type !== 'FLASHCARD_SET' || item.status !== 'ACTIVE') {
      throw new NotFoundException('Flashcard set not found');
    }

    const [current] = await this.db
      .select()
      .from(contentVersions)
      .where(and(eq(contentVersions.contentId, contentId), eq(contentVersions.version, item.currentVersion)))
      .limit(1);
    const cards = ((current?.payload as { cards?: Array<{ id: string; front: string; back: string }> })?.cards ?? []);

    return cards.map((c, i) => ({
      
      sourceKey: `fc:${c.id}`,
      sortOrder: i,
      prompt: c.front,
      reveal: c.back,
      questionType: null,
      payload: { card: c },
    }));
  }

  private async questionItems(instituteId: string, topicId?: string) {
    const scope = [
      eq(questions.instituteId, instituteId),
      eq(questions.approvalStatus, 'APPROVED'),
      eq(questions.status, 'ACTIVE'),
    ];
    if (topicId) {
      const [topic] = await this.db
        .select({ id: topics.id })
        .from(topics)
        .innerJoin(chapters, eq(chapters.id, topics.chapterId))
        .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
        .where(and(eq(topics.id, topicId), eq(subjects.instituteId, instituteId)))
        .limit(1);
      if (!topic) throw new NotFoundException('Topic not found');
      scope.push(eq(questions.topicId, topicId));
    }

    const rows = await this.db
      .select({ id: questions.id, stem: questions.stem, questionType: questions.questionType, payload: questions.payload })
      .from(questions)
      .where(and(...scope))
      .orderBy(asc(questions.createdAt));

    return rows.map((q, i) => ({
      
      sourceKey: `q:${q.id}`,
      sortOrder: i,
      prompt: q.stem,
      reveal: null,
      questionType: q.questionType,
      payload: q.payload as unknown as Record<string, unknown>,
    }));
  }

  private flashcardResponse(dto: PracticeSaveAnswerDto): ResponseValues {
    if (!dto.rating) throw new BadRequestException('rating required for flashcard item');
    if (dto.answer) throw new BadRequestException('answer is not valid for flashcard items');
    return { answer: null, rating: dto.rating, isCorrect: null };
  }

  private questionResponse(item: ItemRow, dto: PracticeSaveAnswerDto): ResponseValues {
    if (!dto.answer || typeof dto.answer !== 'object') {
      throw new BadRequestException('answer required for question item');
    }
    if (dto.rating) throw new BadRequestException('rating is not valid for question items');
    const { isCorrect } = gradeAnswer(item.questionType ?? '', item.payload, dto.answer);
    return { answer: dto.answer, rating: null, isCorrect };
  }

  /**
   * Student-facing item. Sanitized source payload (MCQ choices only — the
   * correct choice / answer key lives in the server-side snapshot and is
   * never serialized, mirroring attempt detail). A QUESTION item only reveals
   * the correct answer AND feedback after the student answers that item; a
   * FLASHCARD item always shows its back face (cards are content, not keys).
   */
  private serializeItem(item: ItemRow, response: ResponseRow | undefined) {
    const base = {
      id: item.id,
      sourceKey: item.sourceKey,
      sortOrder: item.sortOrder,
      prompt: item.prompt,
      questionType: item.questionType ?? undefined,
      payload:
        item.questionType === 'MCQ' && item.payload
          ? { choices: (item.payload as { choices?: unknown }).choices ?? [] }
          : {},
      answer: undefined as unknown,
      rating: undefined as 'AGAIN' | 'GOOD' | undefined,
      isCorrect: undefined as boolean | undefined,
      reveal: undefined as string | undefined,
    };

    // Cards are content, not keys: a FLASHCARD item always shows its back
    // face. A QUESTION item only reveals the answer after it is answered.
    if (item.questionType) {
      if (!response) return base;
      const { correctAnswer } = gradeAnswer(item.questionType, item.payload, response.answer);
      return {
        ...base,
        answer: response.answer,
        isCorrect: response.isCorrect ?? false,
        reveal: JSON.stringify(correctAnswer),
      };
    }
    return { ...base, reveal: item.reveal ?? undefined, rating: response?.rating ?? undefined };
  }

  private async loadOwn(instituteId: string, studentId: string, sessionId: string) {
    const [session] = await this.db
      .select()
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.id, sessionId),
          eq(practiceSessions.instituteId, instituteId),
          eq(practiceSessions.studentId, studentId),
        ),
      )
      .limit(1);
    if (!session) throw new NotFoundException('Practice session not found');
    return session;
  }
}