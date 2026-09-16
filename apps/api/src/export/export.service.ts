import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { and, eq, inArray, isNull, or, asc, isNotNull, sql } from 'drizzle-orm';
import {
  contentItems,
  contentVersions,
  questions,
  assessments,
  assessmentQuestions,
  questionPapers,
  questionPaperQuestions,
  paperPatterns,
  paperPatternSubjects,
  subjects,
  questionTypes,
  attempts,
  attemptQuestions,
  attemptResponses,
  topics,
  users,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import type { PaperPatternStructure } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { contentBlocks, questionDocBlock, exportPaperBlocks } from './export.content-blocks.js';
import type { DocBlock, DocumentModel } from './export.content-blocks.js';
import { paperPatternDoc } from './paper-pattern-doc.js';
import { buildAnalytics } from '../attempts/analytics.js';
import { PuppeteerService } from './puppeteer.service.js';

export type { DocBlock, DocumentModel };

@Injectable()
export class ExportService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly puppeteer: PuppeteerService,
  ) {}

  /** Send the document as PDF via the shared Puppeteer renderer — the same
   * HTML/CSS the preview shows, so the file always matches the preview. */
  async sendPdf(res: Response, model: DocumentModel, filename: string): Promise<void> {
    const buffer = await this.puppeteer.pdf(model);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    res.send(buffer);
  }

  async buildContentDoc(instituteId: string, contentId: string): Promise<DocumentModel> {
    const [item] = await this.db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, contentId), eq(contentItems.instituteId, instituteId)))
      .limit(1);
    if (!item) throw new NotFoundException('Content item not found');

    const [version] = await this.db
      .select()
      .from(contentVersions)
      .where(
        and(
          eq(contentVersions.contentId, contentId),
          eq(contentVersions.version, item.currentVersion),
        ),
      )
      .limit(1);
    if (!version) throw new NotFoundException('Content version not found');

    return {
      title: item.title,
      blocks: contentBlocks(item.type, version.payload as Record<string, unknown>),
    };
  }

  async buildQuestionsDoc(
    instituteId: string,
    scope: { subjectId?: string; chapterId?: string; topicId?: string; patternId?: string } = {},
    include: 'paper' | 'answers' = 'paper',
  ): Promise<DocumentModel> {
    const includeAnswers = include === 'answers';

    const conditions = [
      and(
        eq(questions.instituteId, instituteId),
        eq(questions.approvalStatus, 'APPROVED'),
        eq(questions.status, 'ACTIVE'),
      ),
    ];
    if (scope.patternId) conditions.push(eq(questions.sourcePatternId, scope.patternId));
    if (scope.subjectId) conditions.push(eq(questions.subjectId, scope.subjectId));
    if (scope.chapterId) conditions.push(eq(questions.chapterId, scope.chapterId));
    if (scope.topicId) conditions.push(eq(questions.topicId, scope.topicId));

    const rows = await this.db
      .select({
        stem: questions.stem,
        questionType: questions.questionType,
        difficulty: questions.difficulty,
        payload: questions.payload,
        explanation: questions.explanation,
      })
      .from(questions)
      .where(and(...conditions))
      .orderBy(questions.createdAt);

    // A pattern-scoped bank export renders as a paper: the pattern is the
    // arrangement rule (section order, per-question marks, attempt N of M),
    // and the generated bank questions fill it. Without a pattern it stays a
    // flat practice pool.
    let pattern: (typeof paperPatterns.$inferSelect) | undefined;
    let sections: PaperPatternStructure['sections'] = [];
    if (scope.patternId) {
      const [row] = await this.db
        .select()
        .from(paperPatterns)
        .where(
          and(eq(paperPatterns.id, scope.patternId), eq(paperPatterns.instituteId, instituteId)),
        )
        .limit(1);
      if (!row) throw new NotFoundException('Paper pattern not found');
      pattern = row;
      sections = ((row.structure as PaperPatternStructure | null)?.sections ?? []).filter(
        (s) => s.questionType,
      );
    }

    const blocks: DocBlock[] = [];
    if (pattern) {
      blocks.push({
        kind: 'paragraph',
        text: `Duration: ${sections && pattern.structure ? ((pattern.structure as PaperPatternStructure).durationMinutes ?? '—') : '—'} minutes  ·  Max marks: ${(pattern.structure as PaperPatternStructure | null)?.totalMarks ?? '—'}`,
      });
    }

    const questionBlock = (q: (typeof rows)[number], marks?: number | null): DocBlock =>
      questionDocBlock({
        stem: q.stem,
        type: q.questionType,
        difficulty: q.difficulty,
        marks,
        payload: (q.payload ?? {}) as Record<string, unknown>,
        explanation: q.explanation,
        includeAnswers,
        scope: include === 'paper' ? 'paper' : 'teacher',
      });

    if (sections.length > 0) {
      // Group the bank by the pattern's sections (matching on questionType).
      for (const section of sections) {
        const sectionQuestions = rows.filter((q) => q.questionType === section.questionType);
        if (sectionQuestions.length === 0) continue;
        blocks.push({ kind: 'heading', text: section.name });
        if (
          include === 'paper' &&
          !section.compulsory &&
          section.attemptCount &&
          section.count
        ) {
          blocks.push({
            kind: 'paragraph',
            text: `Attempt any ${section.attemptCount} of ${section.count} questions in this section.`,
          });
        }
        blocks.push(
          ...sectionQuestions.map((q) =>
            questionBlock(q, section.marksPerQuestion ?? undefined),
          ),
        );
      }
      const general = rows.filter((q) => !sections.some((s) => s.questionType === q.questionType));
      if (general.length > 0) {
        blocks.push({ kind: 'heading', text: 'General' });
        blocks.push(...general.map((q) => questionBlock(q)));
      }
    } else {
      blocks.push(...rows.map((q) => questionBlock(q)));
    }

    return {
      title:
        include === 'paper'
          ? (pattern ? `${pattern.title} — Question Paper` : 'Question Bank Export')
          : (pattern ? `${pattern.title} — Question Bank Answer Key` : 'Question Bank Answer Key'),
      blocks,
    };
  }

  /** Teacher-facing assessment results: the attempt ledger plus the computed
   * analysis (aggregates only — never per-student answers or answer keys). */
  async buildAssessmentResultsDoc(instituteId: string, assessmentId: string): Promise<DocumentModel> {
    const [assessmentRow] = await this.db
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, assessmentId), eq(assessments.instituteId, instituteId)))
      .limit(1);
    if (!assessmentRow) throw new NotFoundException('Assessment not found');

    const [attemptsRows, analytics] = await Promise.all([
      this.db
        .select({
          id: attempts.id,
          studentName: users.name,
          status: attempts.status,
          submittedAt: attempts.submittedAt,
          score: attempts.score,
          totalMarks: attempts.totalMarks,
        })
        .from(attempts)
        .innerJoin(users, eq(users.id, attempts.studentId))
        .where(and(eq(attempts.assessmentId, assessmentId), eq(attempts.instituteId, instituteId)))
        .orderBy(asc(attempts.startedAt)),
      this.computeAssessmentAnalytics(instituteId, assessmentId),
    ]);

    const blocks: DocBlock[] = [];
    const s = analytics.summary;
    blocks.push({
      kind: 'paragraph',
      text:
        `Evaluated attempts: ${s.evaluatedAttempts}  ·  ` +
        `Average: ${s.averageScore ?? '—'}  ·  Highest: ${s.highestScore ?? '—'}  ·  ` +
        `Lowest: ${s.lowestScore ?? '—'}  ·  Total marks: ${s.totalMarks ?? '—'}`,
    });

    if (attemptsRows.length > 0) {
      blocks.push({
        kind: 'heading',
        text: 'Attempts',
      });
      blocks.push({
        kind: 'table',
        headers: ['Student', 'Status', 'Submitted', 'Score', 'Total marks'],
        rows: attemptsRows.map((a) => [
          a.studentName,
          a.status,
          a.submittedAt ? a.submittedAt.toISOString().slice(0, 16).replace('T', ' ') : '—',
          String(a.score ?? '—'),
          String(a.totalMarks ?? '—'),
        ]),
      });
    }

    if (s.evaluatedAttempts > 0) {
      blocks.push({ kind: 'heading', text: 'Score distribution' });
      blocks.push({
        kind: 'table',
        headers: ['Score', 'Attempts'],
        rows: analytics.scoreDistribution.map((d) => [String(d.score), String(d.count)]),
      });
    }

    if (analytics.questionAccuracy.length > 0) {
      blocks.push({ kind: 'heading', text: 'Question performance' });
      blocks.push({
        kind: 'table',
        headers: ['#', 'Question', 'Type', 'Accuracy'],
        rows: analytics.questionAccuracy.map((q, i) => [
          String(i + 1),
          q.stem.slice(0, 90),
          q.questionType,
          q.accuracy === null ? '—' : `${Math.round(q.accuracy * 100)}%`,
        ]),
      });
      blocks.push({ kind: 'heading', text: 'Topic performance' });
      blocks.push({
        kind: 'table',
        headers: ['Topic', 'Questions', 'Accuracy', 'Marks earned / available'],
        rows: analytics.topicPerformance.map((t) => [
          t.topicName ?? '—',
          String(t.questionCount),
          t.accuracy === null ? '—' : `${Math.round(t.accuracy * 100)}%`,
          `${t.marksEarned} / ${t.marksAvailable}`,
        ]),
      });
      blocks.push({ kind: 'heading', text: 'Difficulty performance' });
      blocks.push({
        kind: 'table',
        headers: ['Difficulty', 'Questions', 'Accuracy', 'Marks earned / available'],
        rows: analytics.difficultyPerformance.map((d) => [
          d.difficulty,
          String(d.questionCount),
          d.accuracy === null ? '—' : `${Math.round(d.accuracy * 100)}%`,
          `${d.marksEarned} / ${d.marksAvailable}`,
        ]),
      });
    }

    return {
      title: `${assessmentRow.title} — Results`,
      blocks,
    };
  }

  /** Analysis used by the results export. Same evaluated-attempt scope as the
   * attempts module; aggregates only (a result sheet must never expose answer
   * keys or per-student answers). */
  private async computeAssessmentAnalytics(instituteId: string, assessmentId: string) {
    const evaluated = ['SUBMITTED', 'EXPIRED'];
    const scope = and(
      eq(attempts.assessmentId, assessmentId),
      eq(attempts.instituteId, instituteId),
      inArray(attempts.status, evaluated),
      isNotNull(attempts.score),
    );

    const [attemptRows, questionRows] = await Promise.all([
      this.db
        .select({ score: attempts.score, totalMarks: attempts.totalMarks })
        .from(attempts)
        .where(scope)
        .orderBy(asc(attempts.score)),
      this.db
        .select({
          questionId: attemptQuestions.questionId,
          stem: attemptQuestions.stem,
          sortOrder: attemptQuestions.sortOrder,
          marks: attemptQuestions.marks,
          questionType: attemptQuestions.questionType,
          difficulty: questions.difficulty,
          topicId: questions.topicId,
          topicName: topics.name,
          responses: sql<number>`count(${attemptResponses.id})::int`,
          correct: sql<number>`count(*) filter (where ${attemptResponses.isCorrect})::int`,
          incorrect: sql<number>`count(*) filter (where ${attemptResponses.isCorrect} = false)::int`,
          marksAwarded: sql<number>`coalesce(sum(${attemptResponses.marksAwarded}), 0)::int`,
        })
        .from(attemptQuestions)
        .innerJoin(attempts, eq(attempts.id, attemptQuestions.attemptId))
        .innerJoin(questions, eq(questions.id, attemptQuestions.questionId))
        .leftJoin(topics, eq(topics.id, questions.topicId))
        .leftJoin(attemptResponses, eq(attemptResponses.attemptQuestionId, attemptQuestions.id))
        .where(scope)
        .groupBy(
          attemptQuestions.questionId,
          attemptQuestions.stem,
          attemptQuestions.sortOrder,
          attemptQuestions.marks,
          attemptQuestions.questionType,
          questions.difficulty,
          questions.topicId,
          topics.name,
        ),
    ]);

    return buildAnalytics(
      attemptRows.map((r) => ({ score: r.score as number, totalMarks: r.totalMarks })),
      questionRows.map((r) => ({
        ...r,
        topicId: r.topicId,
        topicName: r.topicName,
      })),
    );
  }

  async buildAssessmentDoc(
    instituteId: string,
    assessmentId: string,
    scope: 'paper' | 'teacher' = 'paper',
  ): Promise<DocumentModel> {
    const [assessment] = await this.db
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, assessmentId), eq(assessments.instituteId, instituteId)))
      .limit(1);
    if (!assessment) throw new NotFoundException('Assessment not found');

    const links = await this.db
      .select({
        stem: questions.stem,
        questionType: questions.questionType,
        difficulty: questions.difficulty,
        payload: questions.payload,
        explanation: questions.explanation,
        marks: assessmentQuestions.marks,
        sortOrder: assessmentQuestions.sortOrder,
        section: assessmentQuestions.section,
      })
      .from(assessmentQuestions)
      .innerJoin(questions, eq(assessmentQuestions.questionId, questions.id))
      .where(eq(assessmentQuestions.assessmentId, assessmentId))
      .orderBy(asc(assessmentQuestions.sortOrder));

    const patternSections = await this.patternSectionsForBlueprint(
      instituteId,
      assessment.blueprintId,
    );

    const blocks = exportPaperBlocks({
      title: assessment.title,
      durationMinutes: assessment.durationMinutes,
      maxMarks: assessment.maxMarks,
      subjects: [],
      dateTime: {},
      instructions: assessment.instructions,
      links,
      patternSections,
      scope,
    });
    return { title: assessment.title, blocks };
  }

  async buildQuestionPaperDoc(
    instituteId: string,
    paperId: string,
    dateTime: { date?: string; time?: string } = {},
  ): Promise<DocumentModel> {
    const [paper] = await this.db
      .select()
      .from(questionPapers)
      .where(and(eq(questionPapers.id, paperId), eq(questionPapers.instituteId, instituteId)))
      .limit(1);
    if (!paper) throw new NotFoundException('Question paper not found');

    const links = await this.db
      .select({
        stem: questions.stem,
        questionType: questions.questionType,
        difficulty: questions.difficulty,
        payload: questions.payload,
        explanation: questions.explanation,
        marks: questionPaperQuestions.marks,
        sortOrder: questionPaperQuestions.sortOrder,
        section: questionPaperQuestions.section,
      })
      .from(questionPaperQuestions)
      .innerJoin(questions, eq(questionPaperQuestions.questionId, questions.id))
      .where(eq(questionPaperQuestions.paperId, paperId))
      .orderBy(asc(questionPaperQuestions.sortOrder));

    const patternSections = await this.patternSectionsForBlueprint(
      instituteId,
      paper.blueprintId,
    );

    const subjects = await this.subjectNamesForBlueprint(instituteId, paper.blueprintId);

    const blocks = exportPaperBlocks({
      title: paper.title,
      durationMinutes: paper.durationMinutes,
      maxMarks: paper.maxMarks,
      subjects,
      dateTime,
      instructions: paper.instructions,
      links,
      patternSections,
      scope: 'paper',
    });
    return { title: paper.title, blocks };
  }

  /** Subject display names for a paper-pattern blueprint (empty when none). */
  private async subjectNamesForBlueprint(
    instituteId: string,
    blueprintId: string | null,
  ): Promise<string[]> {
    if (!blueprintId) return [];
    const subjectIds = await this.db
      .select({ subjectId: paperPatternSubjects.subjectId })
      .from(paperPatternSubjects)
      .where(eq(paperPatternSubjects.patternId, blueprintId));
    if (subjectIds.length === 0) return [];
    const rows = await this.db
      .select({ name: subjects.name })
      .from(subjects)
      .where(
        and(
          inArray(subjects.id, subjectIds.map((r) => r.subjectId)),
          eq(subjects.instituteId, instituteId),
        ),
      );
    return rows.map((r) => r.name);
  }

  /** Section metadata (attempt N of M rendering) from a paper-pattern
   * blueprint, when one is attached. */
  private async patternSectionsForBlueprint(
    instituteId: string,
    blueprintId: string | null,
  ): Promise<PaperPatternStructure['sections']> {
    if (!blueprintId) return [];
    const [pattern] = await this.db
      .select({ structure: paperPatterns.structure })
      .from(paperPatterns)
      .where(
        and(
          eq(paperPatterns.id, blueprintId),
          eq(paperPatterns.instituteId, instituteId),
        ),
      )
      .limit(1);
    if (pattern?.structure) {
      return (pattern.structure as PaperPatternStructure).sections;
    }
    return [];
  }

  async buildPaperPatternDoc(instituteId: string, patternId: string): Promise<DocumentModel> {
    const [pattern] = await this.db
      .select()
      .from(paperPatterns)
      .where(and(eq(paperPatterns.id, patternId), eq(paperPatterns.instituteId, instituteId)))
      .limit(1);
    if (!pattern) throw new NotFoundException('Paper pattern not found');

    const subjectRows = await this.db
      .select({ subjectId: paperPatternSubjects.subjectId })
      .from(paperPatternSubjects)
      .where(eq(paperPatternSubjects.patternId, patternId));
    const subjectIds = subjectRows.map((r) => r.subjectId);
    const subjectNames: Record<string, string> = {};
    if (subjectIds.length > 0) {
      const nameRows = await this.db
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(inArray(subjects.id, subjectIds));
      for (const s of nameRows) subjectNames[s.id] = s.name;
    }

    const structure = pattern.structure as PaperPatternStructure | null;
    const codes = new Set<string>();
    if (structure) {
      for (const section of structure.sections) {
        if (section.questionType) codes.add(section.questionType);
      }
    }
    const questionTypeNames: Record<string, string> = {};
    if (codes.size > 0) {
      const typeRows = await this.db
        .select({ code: questionTypes.code, name: questionTypes.name })
        .from(questionTypes)
        .where(
          and(
            inArray(questionTypes.code, [...codes]),
            or(isNull(questionTypes.instituteId), eq(questionTypes.instituteId, instituteId)),
          ),
        );
      for (const t of typeRows) questionTypeNames[t.code] ??= t.name;
    }

    return paperPatternDoc({
      title: pattern.title,
      description: pattern.description,
      status: pattern.status,
      version: pattern.version,
      subjectIds,
      structure,
      subjectNames,
      questionTypeNames,
    });
  }
}
