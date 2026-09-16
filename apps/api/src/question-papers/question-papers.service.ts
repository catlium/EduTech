import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import {
  questionPapers,
  questionPaperQuestions,
  paperPatterns,
  paperPatternSubjects,
  questions,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import type { PaperPatternStructure } from '@catlium/contracts';
import { PaperPatternStructureSchema } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { ExaminationsService } from '../examinations/examinations.service.js';
import {
  planAutoSelection,
  computePatternCoverage,
  type Difficulty,
} from '../examinations/paper-selection.js';

export interface CreateQuestionPaperInput {
  patternId: string;
  title?: string;
  description?: string;
}

/** A Question Paper is a fixed, teacher-selected paper built from an approved
 * pattern. It never creates an assessment; converting it is an explicit
 * "Create assessment from this paper" step. */
@Injectable()
export class QuestionPapersService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly examinations: ExaminationsService,
  ) {}

  // ── Create ────────────────────────────────

  async createQuestionPaper(
    instituteId: string,
    createdBy: string,
    input: CreateQuestionPaperInput,
  ) {
    const pattern = await this.requireApprovedPattern(instituteId, input.patternId);
    const structure = pattern.structure as PaperPatternStructure;

    const [paper] = await this.db
      .insert(questionPapers)
      .values({
        instituteId,
        title: input.title ?? `${pattern.title} — Question Paper`,
        description: input.description ?? pattern.description,
        blueprintId: pattern.id,
        durationMinutes: structure.durationMinutes,
        maxMarks: structure.totalMarks,
        instructions: structuredIntoInstructions(structure),
        createdBy,
        updatedBy: createdBy,
      })
      .returning();

    return paper!;
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
    return paper;
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
    const structure = pattern.structure as PaperPatternStructure;
    const sections = structureSections(structure);

    const subjectRows = await this.db
      .select({ subjectId: paperPatternSubjects.subjectId })
      .from(paperPatternSubjects)
      .where(eq(paperPatternSubjects.patternId, pattern.id));
    const subjectIds = subjectRows.map((r) => r.subjectId);

    const linked = await this.db
      .select({ questionId: questionPaperQuestions.questionId })
      .from(questionPaperQuestions)
      .where(eq(questionPaperQuestions.paperId, paperId));
    const taken = new Set(linked.map((r) => r.questionId));

    const typeCodes = new Set(
      sections.flatMap((s) => (s.questionType ? [s.questionType] : [])),
    );
    const conditions = [
      eq(questions.instituteId, instituteId),
      eq(questions.approvalStatus, 'APPROVED'),
      eq(questions.status, 'ACTIVE'),
    ];
    if (subjectIds.length > 0) conditions.push(inArray(questions.subjectId, subjectIds));
    if (typeCodes.size > 0) conditions.push(inArray(questions.questionType, [...typeCodes]));

    const rows = await this.db
      .select({ id: questions.id, questionType: questions.questionType, difficulty: questions.difficulty })
      .from(questions)
      .where(and(...conditions));

    const plan = planAutoSelection(
      sections,
      rows.map((r) => ({ id: r.id, questionType: r.questionType, difficulty: r.difficulty as Difficulty })),
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
    const structure = pattern.structure as PaperPatternStructure;
    const links = await this.listQuestions(instituteId, paperId);

    return {
      patternId: pattern.id,
      patternTitle: pattern.title,
      sections: computePatternCoverage(
        structureSections(structure),
        links.map((l) => ({
          section: l.section,
          questionType: l.question.questionType,
          marks: l.marks,
        })),
      ),
    };
  }

  // ── Convert to assessment ─────────────────

  async createAssessmentFromPaper(instituteId: string, userId: string, paperId: string) {
    const paper = await this.requirePaper(instituteId, paperId);
    const links = await this.listQuestions(instituteId, paperId);

    if (links.length === 0) {
      throw new BadRequestException('Question paper has no questions to convert');
    }

    const assessment = await this.examinations.createAssessment(instituteId, userId, {
      title: `${paper.title} — Assessment`,
      description: paper.description ?? undefined,
      durationMinutes: paper.durationMinutes ?? undefined,
      maxMarks: paper.maxMarks ?? undefined,
      instructions:
        (paper.instructions as Record<string, unknown> | null | undefined) ?? undefined,
      blueprintId: paper.blueprintId ?? undefined,
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
    const parsed = PaperPatternStructureSchema.safeParse(pattern.structure);
    if (!parsed.success) {
      throw new BadRequestException('Paper pattern structure is not currently valid');
    }
    return pattern;
  }
}

function structureSections(structure: PaperPatternStructure) {
  return structure.sections.map((s) => ({
    id: s.id,
    name: s.name,
    questionType: s.questionType ?? null,
    count: s.count ?? null,
    marksPerQuestion: s.marksPerQuestion ?? null,
    totalMarks: s.totalMarks ?? null,
    compulsory: s.compulsory,
    attemptCount: s.attemptCount ?? null,
    difficultyDistribution: (s.difficultyDistribution ?? null) as
      | Partial<Record<Difficulty, number>>
      | null,
  }));
}

function structuredIntoInstructions(structure: PaperPatternStructure): Record<string, unknown> {
  return { text: structure.instructions.join('. ') };
}