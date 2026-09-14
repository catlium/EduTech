import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import {
  contentItems,
  contentVersions,
  questions,
  assessments,
  assessmentQuestions,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { contentBlocks, questionDocBlock } from './export.content-blocks.js';
import type { DocBlock, DocumentModel } from './export.content-blocks.js';

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
}
