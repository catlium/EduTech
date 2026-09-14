import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  contentItems,
  contentVersions,
  questions,
  assessments,
  assessmentQuestions,
  paperPatterns,
  paperPatternSubjects,
  subjects,
  questionTypes,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import type { PaperPatternStructure } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { contentBlocks, questionDocBlock } from './export.content-blocks.js';
import type { DocBlock, DocumentModel } from './export.content-blocks.js';
import { paperPatternDoc } from './paper-pattern-doc.js';

export type { DocBlock, DocumentModel };

@Injectable()
export class ExportService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

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
    scope: { subjectId?: string; chapterId?: string; topicId?: string } = {},
  ): Promise<DocumentModel> {
    const conditions = [
      and(
        eq(questions.instituteId, instituteId),
        eq(questions.approvalStatus, 'APPROVED'),
        eq(questions.status, 'ACTIVE'),
      ),
    ];
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

    return {
      title: 'Question Bank Export',
      blocks: rows.map((r) =>
        questionDocBlock({
          stem: r.stem,
          type: r.questionType,
          difficulty: r.difficulty,
          payload: (r.payload ?? {}) as Record<string, unknown>,
          explanation: r.explanation,
          includeAnswers: true,
        }),
      ),
    };
  }

  async buildAssessmentDoc(instituteId: string, assessmentId: string): Promise<DocumentModel> {
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
      })
      .from(assessmentQuestions)
      .innerJoin(questions, eq(assessmentQuestions.questionId, questions.id))
      .where(eq(assessmentQuestions.assessmentId, assessmentId))
      .orderBy(assessmentQuestions.sortOrder);

    const blocks: DocBlock[] = [
      {
        kind: 'paragraph',
        text: `Duration: ${assessment.durationMinutes ?? '—'} minutes  ·  Max marks: ${assessment.maxMarks ?? '—'}`,
      },
    ];
    const rawInstructions = assessment.instructions as string[] | { text: string } | null;
    const instructionLines = Array.isArray(rawInstructions)
      ? rawInstructions.filter((i): i is string => typeof i === 'string')
      : rawInstructions && typeof rawInstructions['text'] === 'string'
        ? [rawInstructions['text']]
        : [];
    if (instructionLines.length > 0) {
      blocks.push({ kind: 'bullets', items: instructionLines });
    }
    blocks.push(
      ...links.map((l): DocBlock =>
        questionDocBlock({
          stem: l.stem,
          type: l.questionType,
          difficulty: l.difficulty,
          marks: l.marks,
          payload: (l.payload ?? {}) as Record<string, unknown>,
          explanation: l.explanation,
          includeAnswers: false,
        }),
      ),
    );

    return { title: assessment.title, blocks };
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
