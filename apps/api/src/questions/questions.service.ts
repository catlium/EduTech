import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { eq, and, desc, ilike, inArray, isNull, not, or, type SQL } from 'drizzle-orm';
import { questions } from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  FormatPayloadSchemas,
  QuestionPayloadSchemas,
  type QuestionTypeDefinition,
} from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { resolveScopeChain } from '../common/utils/scope-resolver.js';
import { AcademicScopeService } from '../authorization/academic-scope.service.js';
import { QuestionTypesService } from './question-types.service.js';

type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
type QuestionSource = 'MANUAL' | 'AI_GENERATED' | 'EXTRACTED';
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
    private readonly scope: AcademicScopeService,
  ) {}

  // ── Create ────────────────────────────────

  async createQuestion(instituteId: string, membershipId: string, createdBy: string, input: CreateQuestionInput) {
    const type = await this.typesService.findByCode(instituteId, input.questionType);
    this.validatePayload(type, input.payload);

    const chain = await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: false },
      input,
    );
    // Create within the actor's scope (§18.5): an unscoped (no-subject)
    // question is institute-wide content → admin-only (§18.7).
    await this.scope.requireWritableSubject(instituteId, membershipId, chain.subjectId);

    // AI-generated questions are derived content: available in the bank
    // immediately (APPROVED) with no mandatory confirmation gate. Review stays
    // available as a capability — any question can be REJECTED/ARCHIVED later.
    const approvalStatus: QuestionApprovalStatus = 'APPROVED';

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

  async listQuestions(
    instituteId: string,
    membershipId: string,
    userId: string,
    filters: ListQuestionFilters = {},
  ) {
    const conditions: SQL[] = [
      eq(questions.instituteId, instituteId),
      // Extraction candidates live in REVIEW while pending import; the bank
      // list (and practice/examination pickers below it) must never surface
      // un-imported REVIEW rows as ordinary questions.
      not(eq(questions.status, 'REVIEW')),
      isNull(questions.deletedAt),
      // O1 (§18.6): PENDING staging questions are another actor's un-shared
      // work → only the owner (+ admins) may ever see them.
      or(not(eq(questions.approvalStatus, 'PENDING')), eq(questions.createdBy, userId))!,
    ];

    const scopeFilter = await this.scope.subjectScopePredicate(
      instituteId,
      membershipId,
      questions.subjectId,
    );
    if (scopeFilter) {
      conditions.push(scopeFilter);
    }

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

  async getQuestion(
    instituteId: string,
    membershipId: string,
    userId: string,
    questionId: string,
  ) {
    const [question] = await this.db
      .select()
      .from(questions)
      .where(
        and(
          eq(questions.id, questionId),
          eq(questions.instituteId, instituteId),
          isNull(questions.deletedAt),
        ),
      )
      .limit(1);

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    await this.gateQuestion(instituteId, membershipId, userId, question, false);
    return question;
  }

  /** Owner + scope gate for a question row (§18.5/§18.6/§18.7). Reads deny
   *  with 404 (no existence leak), mutations with 403 (pre-mutation check). */
  private async gateQuestion(
    instituteId: string,
    membershipId: string,
    userId: string,
    question: typeof questions.$inferSelect,
    mutating: boolean,
  ): Promise<void> {
    const deny = mutating
      ? () => new ForbiddenException('Question is outside your academic scope')
      : () => new NotFoundException('Question not found');
    const scope = await this.scope.resolveScope(instituteId, membershipId);
    const inScope =
      scope.kind === 'whole-institute' ||
      (question.subjectId ? scope.subjectIds.includes(question.subjectId) : false);
    if (!inScope) throw deny();
    // O1: staging (REVIEW/PENDING) rows are only the owner's (or an admin's).
    const staging =
      question.status === 'REVIEW' || question.approvalStatus === 'PENDING';
    if (staging && scope.kind !== 'whole-institute' && question.createdBy !== userId) {
      throw deny();
    }
  }

  // ── Update ────────────────────────────────

  async updateQuestion(
    instituteId: string,
    membershipId: string,
    userId: string,
    questionId: string,
    patch: QuestionUpdateInput,
  ) {
    const existing = await this.lockQuestion(instituteId, membershipId, userId, questionId, true);

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

  async deleteQuestion(
    instituteId: string,
    membershipId: string,
    userId: string,
    questionId: string,
  ) {
    await this.lockQuestion(instituteId, membershipId, userId, questionId, true);

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
    membershipId: string,
    userId: string,
    questionId: string,
    approvalStatus: 'APPROVED' | 'REJECTED',
  ) {
    await this.lockQuestion(instituteId, membershipId, userId, questionId, true);

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

  async setStatus(
    instituteId: string,
    membershipId: string,
    userId: string,
    questionId: string,
    status: 'ACTIVE' | 'ARCHIVED',
  ) {
    await this.lockQuestion(instituteId, membershipId, userId, questionId, true);

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
    membershipId: string,
    userId: string,
    questionIds: string[],
    approvalStatus: 'APPROVED' | 'REJECTED',
  ) {
    const rows = await this.db
      .select()
      .from(questions)
      .where(and(eq(questions.instituteId, instituteId), inArray(questions.id, questionIds)));
    const allowed = rows.filter((row) => {
      try {
        this.gateQuestion(instituteId, membershipId, userId, row, true);
        return true;
      } catch {
        return false;
      }
    });

    const result = await this.db
      .update(questions)
      .set({ approvalStatus, updatedAt: new Date() })
      .where(and(eq(questions.instituteId, instituteId), inArray(questions.id, allowed.map((r) => r.id))))
      .returning({ id: questions.id });

    return result.map((row) => row.id);
  }

  // ── Helpers ───────────────────────────────

  /** Fetch + full write gate (owner + scope) for an existing question. */
  private async lockQuestion(
    instituteId: string,
    membershipId: string,
    userId: string,
    questionId: string,
    mutating: boolean,
  ) {
    const [question] = await this.db
      .select()
      .from(questions)
      .where(
        and(
          eq(questions.id, questionId),
          eq(questions.instituteId, instituteId),
          isNull(questions.deletedAt),
        ),
      )
      .limit(1);
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    await this.gateQuestion(instituteId, membershipId, userId, question, mutating);
    return question;
  }

  /** Public payload validation for a question-type code (used by question
   *  extraction acceptance, which stores candidates in a REVIEW state first). */
  async validateQuestionPayload(
    instituteId: string,
    questionType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const type = await this.typesService.findByCode(instituteId, questionType);
    this.validatePayload(type, payload);
  }

  private validatePayload(type: QuestionTypeDefinition, payload: Record<string, unknown>): void {
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
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new BadRequestException(`Invalid ${questionType} payload: expected an object`);
    }
  }
}
