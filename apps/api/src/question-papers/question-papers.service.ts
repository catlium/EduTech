import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  questionPapers,
  questionPaperQuestions,
  paperPatterns,
  questions,
  subjects,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import {
  flattenPatternRules,
  normalizePaperPatternStructure,
  type PaperPatternStructure,
} from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { ExaminationsService } from '../examinations/examinations.service.js';
import { QuestionGenerationService } from '../questions/question-generation.service.js';
import { resolveScopeChain, scopeFilter } from '../common/utils/scope-resolver.js';
import { buildPatternDemandBuckets } from './pattern-demand.js';
import {
  planAutoSelection,
  computePatternCoverage,
  type Difficulty,
} from '../examinations/paper-selection.js';

export interface CreateQuestionPaperInput {
  patternId: string;
  /** Authoritative question scope. Subject is always required; Chapter/Topic
   * are optional refinements. The pattern never supplies scope. */
  subjectId: string;
  chapterId?: string;
  topicId?: string;
  title?: string;
  description?: string;
}

export interface QuestionScope {
  subjectId: string;
  chapterId?: string;
  topicId?: string;
}

/** A Question Paper is a fixed, teacher-selected paper built from an approved
 * pattern. It never creates an assessment; converting it is an explicit
 * "Create assessment from this paper" step. */
@Injectable()
export class QuestionPapersService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly examinations: ExaminationsService,
    private readonly generation: QuestionGenerationService,
  ) {}

  // ── Create ────────────────────────────────

  async createQuestionPaper(
    instituteId: string,
    createdBy: string,
    input: CreateQuestionPaperInput,
  ) {
    const pattern = await this.requireApprovedPattern(instituteId, input.patternId);
    const structure = normalizePaperPatternStructure(pattern.structure);
    // Approved patterns are validated with real totals; guard anyway so a
    // degraded row surfaces as a clear 400 instead of a constraint 500.
    if (structure.totalMarks == null || structure.durationMinutes == null) {
      throw new BadRequestException(
        'Approved pattern is missing total marks or duration — re-validate the pattern before creating the paper',
      );
    }

    // The scope is the authoritative source of questions; the pattern never
    // supplies or infers it. Subject is always required, chapter/topic are
    // optional refinements (topic requires chapter requires subject).
    const scope = await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: true },
      input,
    );
    if (!scope.subjectId) throw new BadRequestException('A question scope requires a subject');

    // Never create a paper the bank cannot fully supply. If questions are
    // missing we queue generation and report back; the caller polls and retries.
    const coverage = await this.generation.ensurePatternCoverage(
      instituteId,
      createdBy,
      pattern.id,
      {
        subjectId: scope.subjectId,
        chapterId: scope.chapterId ?? undefined,
        topicId: scope.topicId ?? undefined,
      },
    );
    if (!coverage.covered) {
      if (coverage.status === 'GENERATING') {
        return {
          status: coverage.status,
          patternId: pattern.id,
          totalDeficit: coverage.totalDeficit,
          totalExisting: coverage.totalExisting,
          buckets: coverage.buckets,
          batchId: coverage.batchId,
          jobIds: coverage.jobIds,
        };
      }
      throw new BadRequestException(
        coverage.status === 'AWAITING_APPROVAL'
          ? `${coverage.totalDeficit} generated question${coverage.totalDeficit === 1 ? ' is' : 's are'} still awaiting approval — approve them in the Question Bank, then generate the paper again.`
          : 'The question bank has too few questions for this pattern to generate the missing ones automatically.',
      );
    }

    const [paper] = await this.db
      .insert(questionPapers)
      .values({
        instituteId,
        title: input.title ?? `${pattern.title} — Question Paper`,
        description: input.description ?? pattern.description,
        blueprintId: pattern.id,
        subjectId: scope.subjectId,
        chapterId: scope.chapterId,
        topicId: scope.topicId,
        durationMinutes: structure.durationMinutes,
        maxMarks: structure.totalMarks,
        instructions: structuredIntoInstructions(structure),
        createdBy,
        updatedBy: createdBy,
      })
      .returning();

    return { paper: paper! };
  }

  // ── Read ──────────────────────────────────

  async listPapers(instituteId: string) {
    const rows = await this.db
      .select()
      .from(questionPapers)
      .where(eq(questionPapers.instituteId, instituteId))
      .orderBy(desc(questionPapers.updatedAt));

    if (rows.length === 0) return [];

    const counts = await this.db
      .select({ paperId: questionPaperQuestions.paperId, count: count() })
      .from(questionPaperQuestions)
      .where(
        inArray(
          questionPaperQuestions.paperId,
          rows.map((r) => r.id),
        ),
      )
      .groupBy(questionPaperQuestions.paperId);
    const countMap = new Map(counts.map((r) => [r.paperId, r.count]));

    return rows.map((r) => ({ ...r, questionCount: countMap.get(r.id) ?? 0 }));
  }

  async getPaper(instituteId: string, paperId: string) {
    const paper = await this.requirePaper(instituteId, paperId);
    const subjects = await this.paperSubjects(instituteId, paper);
    return { ...paper, subjects };
  }

  async renamePaper(instituteId: string, paperId: string, title: string) {
    const existing = await this.requirePaper(instituteId, paperId);
    if (!title.trim()) {
      throw new BadRequestException('Title cannot be blank');
    }
    const [updated] = await this.db
      .update(questionPapers)
      .set({ title: title.trim(), updatedAt: new Date() })
      .where(and(eq(questionPapers.id, paperId), eq(questionPapers.instituteId, instituteId)))
      .returning();
    return updated ?? existing;
  }

  async deletePaper(instituteId: string, paperId: string) {
    const [deleted] = await this.db
      .delete(questionPapers)
      .where(and(eq(questionPapers.id, paperId), eq(questionPapers.instituteId, instituteId)))
      .returning();
    if (!deleted) {
      throw new NotFoundException('Question paper not found');
    }
  }

  async listQuestions(instituteId: string, paperId: string) {
    await this.requirePaper(instituteId, paperId);

    const rows = await this.db
      .select()
      .from(questionPaperQuestions)
      .innerJoin(
        questions,
        and(
          eq(questionPaperQuestions.questionId, questions.id),
          eq(questions.instituteId, instituteId),
        ),
      )
      .where(eq(questionPaperQuestions.paperId, paperId))
      .orderBy(asc(questionPaperQuestions.sortOrder));

    return rows.map((row) => ({
      id: row.question_paper_questions.id,
      paperId: row.question_paper_questions.paperId,
      questionId: row.question_paper_questions.questionId,
      sortOrder: row.question_paper_questions.sortOrder,
      marks: row.question_paper_questions.marks,
      section: row.question_paper_questions.section,
      question: row.questions,
    }));
  }

  // ── Selection (Mode A) ────────────────────

  async autoSelectFromPattern(instituteId: string, paperId: string) {
    const paper = await this.requirePaper(instituteId, paperId);
    if (!paper.blueprintId) {
      throw new BadRequestException('Question paper has no paper-pattern blueprint');
    }

    const pattern = await this.requireApprovedPattern(instituteId, paper.blueprintId);
    const structure = normalizePaperPatternStructure(pattern.structure);
    const sections = flattenPatternRules(structure);

    const scope = await this.paperScope(paper);

    const linked = await this.db
      .select({ questionId: questionPaperQuestions.questionId })
      .from(questionPaperQuestions)
      .where(eq(questionPaperQuestions.paperId, paperId));
    const taken = new Set(linked.map((r) => r.questionId));

    const typeCodes = new Set(sections.flatMap((s) => (s.questionType ? [s.questionType] : [])));
    const conditions = [
      eq(questions.instituteId, instituteId),
      eq(questions.approvalStatus, 'APPROVED'),
      eq(questions.status, 'ACTIVE'),
      isNull(questions.deletedAt),
      scopeFilter(scope),
    ];
    if (typeCodes.size > 0) conditions.push(inArray(questions.questionType, [...typeCodes]));

    const rows = await this.db
      .select({
        id: questions.id,
        questionType: questions.questionType,
        difficulty: questions.difficulty,
      })
      .from(questions)
      .where(and(...conditions));

    const plan = planAutoSelection(
      sections,
      rows.map((r) => ({
        id: r.id,
        questionType: r.questionType,
        difficulty: r.difficulty as Difficulty,
      })),
      taken,
    );

    await this.db.transaction(async (tx) => {
      await tx.delete(questionPaperQuestions).where(eq(questionPaperQuestions.paperId, paperId));
      let base = 0;
      for (const sec of plan.sections) {
        for (const questionId of sec.selected) {
          base += 1;
          await tx.insert(questionPaperQuestions).values({
            paperId,
            questionId,
            sortOrder: base,
            marks: sec.marks,
            section: sec.name,
          });
        }
      }
    });

    return {
      paperId,
      totalSelected: plan.totalSelected,
      totalMarks: plan.totalMarks,
      sections: plan.sections,
    };
  }

  async getPatternCoverage(instituteId: string, paperId: string) {
    const paper = await this.requirePaper(instituteId, paperId);
    if (!paper.blueprintId) return null;

    const pattern = await this.requireApprovedPattern(instituteId, paper.blueprintId);
    const structure = normalizePaperPatternStructure(pattern.structure);
    const links = await this.listQuestions(instituteId, paperId);

    return {
      patternId: pattern.id,
      patternTitle: pattern.title,
      sections: computePatternCoverage(
        flattenPatternRules(structure),
        links.map((l) => ({
          section: l.section,
          questionType: l.question.questionType,
          marks: l.marks,
        })),
      ),
    };
  }

  // ── Generate missing (shortage fill) ─────────────────

  /* Demand buckets for a paper: each section contributes its PRESENTED count
   * (M — for attempt-N-of-M sections the full M must sit in the bank before
   * N can be presented), split across its difficulty distribution. This is
   * DEMAND (what the paper needs), not a pre-computed shortage: the caller
   * (computeDeficitsAndGenerateMore) subtracts the in-scope bank + pending
   * exactly once so the reported deficit survives. Sections sharing a type
   * demand distinct questions — two 3-question MCQ sections need 6 in the
   * bank — so buckets merge per (type, difficulty). */
  private async patternShortageBuckets(
    instituteId: string,
    paperId: string,
  ): Promise<{
    scope: QuestionScope;
    buckets: { questionType: string; difficulty: Difficulty; count: number }[];
  }> {
    const paper = await this.requirePaper(instituteId, paperId);
    if (!paper.blueprintId) {
      throw new BadRequestException('Question paper has no paper-pattern blueprint');
    }
    const pattern = await this.requireApprovedPattern(instituteId, paper.blueprintId);
    const structure = normalizePaperPatternStructure(pattern.structure);
    const scope = await this.paperScope(paper);

    return {
      scope,
      buckets: buildPatternDemandBuckets(structure),
    };
  }

  async generateMissing(instituteId: string, userId: string, paperId: string, dryRun = false) {
    const { scope, buckets } = await this.patternShortageBuckets(instituteId, paperId);
    const filtered = buckets.filter((b) => b.count > 0);
    if (filtered.length === 0) {
      return {
        generated: false,
        batchId: null,
        jobIds: null,
        jobId: null,
        status: 'NO_ACTION' as const,
        buckets: [],
        totalExisting: 0,
        totalDeficit: 0,
      };
    }
    return this.generation.computeDeficitsAndGenerateMore(instituteId, userId, {
      subjectId: scope.subjectId,
      chapterId: scope.chapterId,
      topicId: scope.topicId,
      buckets: filtered,
      dryRun,
    });
  }

  // ── Scope ─────────────────────────────────

  async setScope(instituteId: string, paperId: string, scope: QuestionScope) {
    const existing = await this.requirePaper(instituteId, paperId);
    const resolved = await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: true },
      scope,
    );
    if (!resolved.subjectId) throw new BadRequestException('A question scope requires a subject');
    const [updated] = await this.db
      .update(questionPapers)
      .set({
        subjectId: resolved.subjectId,
        chapterId: resolved.chapterId,
        topicId: resolved.topicId,
        updatedAt: new Date(),
      })
      .where(and(eq(questionPapers.id, paperId), eq(questionPapers.instituteId, instituteId)))
      .returning();
    return updated ?? existing;
  }

  // ── Convert to assessment ─────────────────

  async createAssessmentFromPaper(instituteId: string, userId: string, paperId: string) {
    const paper = await this.requirePaper(instituteId, paperId);
    const scope = await this.paperScope(paper);
    const links = await this.listQuestions(instituteId, paperId);

    if (links.length === 0) {
      throw new BadRequestException('Question paper has no questions to convert');
    }

    const assessment = await this.examinations.createAssessment(instituteId, userId, {
      title: `${paper.title} — Assessment`,
      description: paper.description ?? undefined,
      durationMinutes: paper.durationMinutes ?? undefined,
      maxMarks: paper.maxMarks ?? undefined,
      instructions: (paper.instructions as Record<string, unknown> | null | undefined) ?? undefined,
      blueprintId: paper.blueprintId ?? undefined,
      subjectId: scope.subjectId,
      chapterId: scope.chapterId,
      topicId: scope.topicId,
    });

    await this.examinations.addQuestions(
      instituteId,
      assessment.id,
      links.map((l) => l.questionId),
      Object.fromEntries(links.map((l) => [l.questionId, l.marks])),
      Object.fromEntries(links.map((l) => [l.questionId, l.section])),
    );

    return assessment;
  }

  // ── Internals ─────────────────────────────

  /** Subject names for a paper's stored scope (empty when the paper has no
   * scope — legacy rows that never set one). */
  private async paperSubjects(
    instituteId: string,
    paper: { subjectId: string | null },
  ): Promise<string[]> {
    if (!paper.subjectId) return [];
    const rows = await this.db
      .select({ name: subjects.name })
      .from(subjects)
      .where(and(eq(subjects.id, paper.subjectId), eq(subjects.instituteId, instituteId)));
    return rows.map((r) => r.name);
  }

  /** The paper's own stored scope, always present for new papers. Legacy
   * unscoped papers must set one before selection/generation/conversion. */
  private async paperScope(paper: {
    subjectId: string | null;
    chapterId: string | null;
    topicId: string | null;
  }): Promise<QuestionScope> {
    if (!paper.subjectId) {
      throw new BadRequestException(
        'This paper has no question scope — set a subject (with optional chapter/topic) first',
      );
    }
    // The DB scope-chain CHECK guarantees topic ⇒ chapter ⇒ subject consistency.
    return {
      subjectId: paper.subjectId,
      chapterId: paper.chapterId ?? undefined,
      topicId: paper.topicId ?? undefined,
    };
  }

  private async requirePaper(instituteId: string, paperId: string) {
    const [paper] = await this.db
      .select()
      .from(questionPapers)
      .where(and(eq(questionPapers.id, paperId), eq(questionPapers.instituteId, instituteId)))
      .limit(1);
    if (!paper) {
      throw new NotFoundException('Question paper not found');
    }
    return paper;
  }

  private async requireApprovedPattern(instituteId: string, patternId: string) {
    const [pattern] = await this.db
      .select()
      .from(paperPatterns)
      .where(and(eq(paperPatterns.id, patternId), eq(paperPatterns.instituteId, instituteId)))
      .limit(1);
    if (!pattern) {
      throw new NotFoundException('Paper pattern not found');
    }
    if (pattern.status !== 'APPROVED' || !pattern.structure) {
      throw new BadRequestException(
        'Only an approved paper pattern with a structure can create a question paper',
      );
    }
    try {
      normalizePaperPatternStructure(pattern.structure);
    } catch {
      throw new BadRequestException('Paper pattern structure is not currently valid');
    }
    return pattern;
  }
}

function structuredIntoInstructions(structure: PaperPatternStructure): Record<string, unknown> {
  return { text: structure.instructions.join('. ') };
}
