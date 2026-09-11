import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { contentItems, contentVersions, questions, assessments, assessmentQuestions } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { contentBlocks } from './export.content-blocks.js';
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
      .select({ stem: questions.stem, questionType: questions.questionType, difficulty: questions.difficulty })
      .from(questions)
      .where(and(...conditions))
      .orderBy(questions.createdAt);

    return {
      title: 'Question Bank Export',
      blocks: rows.map(
        (r): DocBlock => ({
          kind: 'question',
          stem: r.stem,
          type: r.questionType,
          difficulty: r.difficulty,
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
    const instructions = assessment.instructions as string[] | null;
    if (Array.isArray(instructions) && instructions.length > 0) {
      blocks.push({ kind: 'bullets', items: instructions });
    }
    blocks.push(
      ...links.map(
        (l): DocBlock => ({
          kind: 'question',
          stem: l.stem,
          type: l.questionType,
          difficulty: l.difficulty,
        }),
      ),
    );

    return { title: assessment.title, blocks };
  }
}