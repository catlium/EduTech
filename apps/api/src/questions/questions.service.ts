import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { eq, and, desc, ilike, inArray, type SQL } from 'drizzle-orm';
import { questions } from '@catlium/database';
import type { Database } from '@catlium/database';
import { FormatPayloadSchemas, QuestionPayloadSchemas, type QuestionTypeDefinition } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { resolveScopeChain } from '../common/utils/scope-resolver.js';
import { QuestionTypesService } from './question-types.service.js';

type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
type QuestionSource = 'MANUAL' | 'AI_GENERATED';
type QuestionApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface ListQuestionFilters {
  questionType?: string;
  difficulty?: QuestionDifficulty;
  approvalStatus?: QuestionApprovalStatus;
  q?: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

interface CreateQuestionInput {
  stem: string;
  questionType: string;
  difficulty?: QuestionDifficulty;
  explanation?: string;
  source: QuestionSource;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
  payload: Record<string, unknown>;
}

type QuestionUpdateInput = Partial<
  Pick<CreateQuestionInput, 'stem' | 'difficulty' | 'explanation' | 'payload'>
>;

@Injectable()
export class QuestionsService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly typesService: QuestionTypesService,
  ) {}

  // ── Create ────────────────────────────────

  async createQuestion(instituteId: string, createdBy: string, input: CreateQuestionInput) {
    const type = await this.typesService.findByCode(instituteId, input.questionType);
    this.validatePayload(type, input.payload);

    const chain = await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: false },
      input,
    );

    const approvalStatus = input.source === 'MANUAL' ? 'APPROVED' : 'PENDING';

    const [question] = await this.db
      .insert(questions)
      .values({
        instituteId,
        subjectId: chain.subjectId,
        chapterId: chain.chapterId,
        topicId: chain.topicId,
        stem: input.stem,
        questionType: input.questionType,
        answerFormat: type.answerFormat,
        difficulty: input.difficulty ?? 'MEDIUM',
        explanation: input.explanation ?? null,
        payload: input.payload,
        source: input.source,
        approvalStatus,
        status: 'ACTIVE',
        createdBy,
        updatedBy: createdBy,
      })
      .returning();

    return question!;
  }

  // ── Read ──────────────────────────────────

  async listQuestions(instituteId: string, filters: ListQuestionFilters = {}) {
    const conditions: SQL[] = [eq(questions.instituteId, instituteId)];

    if (filters.questionType !== undefined) {
      conditions.push(eq(questions.questionType, filters.questionType));
    }
    if (filters.difficulty !== undefined) {
      conditions.push(eq(questions.difficulty, filters.difficulty));
    }
    if (filters.approvalStatus !== undefined) {
      conditions.push(eq(questions.approvalStatus, filters.approvalStatus));
    }
    if (filters.q) {
      conditions.push(ilike(questions.stem, `%${filters.q}%`));
    }
    if (filters.subjectId !== undefined) {
      conditions.push(eq(questions.subjectId, filters.subjectId));
    }
    if (filters.chapterId !== undefined) {
      conditions.push(eq(questions.chapterId, filters.chapterId));
    }
    if (filters.topicId !== undefined) {
      conditions.push(eq(questions.topicId, filters.topicId));
    }

    return this.db
      .select()
      .from(questions)
      .where(and(...conditions))
      .orderBy(desc(questions.updatedAt));
  }

  async getQuestion(instituteId: string, questionId: string) {
    const [question] = await this.db
      .select()
      .from(questions)
      .where(and(eq(questions.id, questionId), eq(questions.instituteId, instituteId)))
      .limit(1);

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    return question;
  }

  // ── Update ────────────────────────────────

  async updateQuestion(
    instituteId: string,
    userId: string,
    questionId: string,
    patch: QuestionUpdateInput,
  ) {
    const existing = await this.getQuestion(instituteId, questionId);

    if (patch.payload !== undefined) {
      const type = await this.typesService.findByCode(instituteId, existing.questionType);
      this.validatePayload(type, patch.payload);
    }

    const [question] = await this.db
      .update(questions)
      .set({
        ...patch,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(questions.id, questionId), eq(questions.instituteId, instituteId)))
      .returning();

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    return question!;
  }

  // ── Delete ────────────────────────────────

  async deleteQuestion(instituteId: string, questionId: string) {
    const [question] = await this.db
      .delete(questions)
      .where(and(eq(questions.id, questionId), eq(questions.instituteId, instituteId)))
      .returning();

    if (!question) {
      throw new NotFoundException('Question not found');
    }
  }

  // ── Approval actions ─────────────────────

  async setApprovalStatus(
    instituteId: string,
    questionId: string,
    approvalStatus: 'APPROVED' | 'REJECTED',
  ) {
    const [question] = await this.db
      .update(questions)
      .set({ approvalStatus, updatedAt: new Date() })
      .where(and(eq(questions.id, questionId), eq(questions.instituteId, instituteId)))
      .returning();

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    return question!;
  }

  async setStatus(instituteId: string, questionId: string, status: 'ACTIVE' | 'ARCHIVED') {
    const [question] = await this.db
      .update(questions)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(questions.id, questionId), eq(questions.instituteId, instituteId)))
      .returning();

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    return question!;
  }

  async batchSetApprovalStatus(
    instituteId: string,
    questionIds: string[],
    approvalStatus: 'APPROVED' | 'REJECTED',
  ) {
    const result = await this.db
      .update(questions)
      .set({ approvalStatus, updatedAt: new Date() })
      .where(
        and(eq(questions.instituteId, instituteId), inArray(questions.id, questionIds)),
      )
      .returning({ id: questions.id });

    return result.map((row) => row.id);
  }

  // ── Helpers ───────────────────────────────

  private validatePayload(
    type: QuestionTypeDefinition,
    payload: Record<string, unknown>,
  ): void {
    /* Per-format payload schema (a custom type reusing a known answer format
     * is validated like the predefined one). Legacy payloads keyed by the old
     * built-in codes are still validated via QuestionPayloadSchemas. */
    const schema =
      FormatPayloadSchemas[type.answerFormat as keyof typeof FormatPayloadSchemas] ??
      QuestionPayloadSchemas[type.code as keyof typeof QuestionPayloadSchemas];

    if (!schema) {
      // Unknown future format → generic object check only (forward-compatible).
      this.checkRecordPayload(type.code, payload);
      return;
    }

    const result = schema.safeParse(payload);

    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.length ? issue.path.join('.') : 'root';
      throw new BadRequestException(
        `Invalid ${type.code} payload: ${path} — ${issue?.message ?? 'does not match schema'}`,
      );
    }
  }

  private checkRecordPayload(questionType: string, payload: Record<string, unknown>): void {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new BadRequestException(
        `Invalid ${questionType} payload: expected an object`,
      );
    }
  }


}