import { Controller, Get, Param, Query, Res, UseGuards, ParseUUIDPipe, ParseEnumPipe } from '@nestjs/common';
import type { Response } from 'express';

import { ExportService } from './export.service.js';
import { buildPreview } from './export.content-blocks.js';
import type { DocumentModel } from './export.content-blocks.js';
import { sendDoc, sendXlsx } from './export.renderers.js';
import { renderDocumentBodyHtml } from './render-html.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const EXPORT_FORMATS = ['pdf', 'docx', 'xlsx'] as const;
const EXPORT_INCLUDES = ['paper', 'answers'] as const;

/* Optional ?buckets=[{"questionType":"MCQ","difficulty":"EASY","count":5}] —
 * JSON array capping the wizard's export to its per-bucket targets. */
const parseBucketsParam = (raw?: string): Array<{ questionType: string; difficulty: string; count: number }> | undefined => {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Array<{ questionType: string; difficulty: string; count: number }>;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(
      (b) =>
        b &&
        typeof b.questionType === 'string' &&
        typeof b.difficulty === 'string' &&
        typeof b.count === 'number' &&
        b.count > 0,
    );
  } catch {
    return undefined;
  }
};

/* Preview payload = digest + document + the shared renderer's body HTML, so
 * the web preview (dangerouslySetInnerHTML) shows the exact representation the
 * Puppeteer PDF produces — one visual source, never a second layout. */
type PreviewPayload = {
  preview: ReturnType<typeof buildPreview> & {
    html: string;
    document: DocumentModel;
  };
};

const withHtml = (raw: ReturnType<typeof buildPreview>): PreviewPayload['preview'] => ({
  ...raw,
  html: renderDocumentBodyHtml(raw.document),
});

/* Every export sends directly. The preview endpoints stay — they render the
 * exact same document the file contains (one shared renderer) — but a preview
 * is a convenience preview, never a prerequisite for exporting. */
@Controller('export')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /* Bare sender shared by every route: PDF via the Puppeteer renderer (same
   * HTML the previews render), DOCX via the structured renderer. */
  private async send(
    res: Response,
    document: DocumentModel,
    format: (typeof EXPORT_FORMATS)[number],
    filename: string,
  ): Promise<void> {
    if (format === 'pdf') {
      await this.exportService.sendPdf(res, document, filename);
    } else if (format === 'xlsx') {
      await sendXlsx(res, document, filename);
    } else {
      sendDoc(res, document, filename);
    }
  }

  @Get('content/:contentId')
  async exportContent(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
  ): Promise<void> {
    const doc = await this.exportService.buildContentDoc(tenant.instituteId, contentId);
    await this.send(res, doc, format, `content-${contentId}`);
  }

  @Get('content/:contentId/preview')
  async previewContent(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ): Promise<PreviewPayload> {
    const doc = await this.exportService.buildContentDoc(tenant.instituteId, contentId);
    return { preview: withHtml(buildPreview(doc)) };
  }

  @Get('questions')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async exportQuestions(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
    @Query('subjectId') subjectId?: string,
    @Query('chapterId') chapterId?: string,
    @Query('topicId') topicId?: string,
    @Query('patternId') patternId?: string,
    @Query('buckets') buckets?: string,
    @Query('include', new ParseEnumPipe(EXPORT_INCLUDES, { optional: true }))
    include: (typeof EXPORT_INCLUDES)[number] = 'paper',
  ): Promise<void> {
    const doc = await this.exportService.buildQuestionsDoc(
      tenant.instituteId,
      tenant.membershipId,
      { subjectId, chapterId, topicId, patternId },
      include,
      parseBucketsParam(buckets),
    );
    await this.send(res, doc, format, 'question-bank-export');
  }

  @Get('questions/preview')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async previewQuestions(
    @Tenant() tenant: TenantContext,
    @Query('subjectId') subjectId?: string,
    @Query('chapterId') chapterId?: string,
    @Query('topicId') topicId?: string,
    @Query('patternId') patternId?: string,
    @Query('buckets') buckets?: string,
    @Query('include', new ParseEnumPipe(EXPORT_INCLUDES, { optional: true }))
    include: (typeof EXPORT_INCLUDES)[number] = 'paper',
  ): Promise<PreviewPayload> {
    const doc = await this.exportService.buildQuestionsDoc(
      tenant.instituteId,
      tenant.membershipId,
      { subjectId, chapterId, topicId, patternId },
      include,
      parseBucketsParam(buckets),
    );
    return { preview: withHtml(buildPreview(doc)) };
  }

  @Get('assessment/:assessmentId')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async exportAssessment(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
    // Paper = student-facing (no answers/difficulty), answers = teacher key.
    @Query('include', new ParseEnumPipe(EXPORT_INCLUDES, { optional: true }))
    include: (typeof EXPORT_INCLUDES)[number] = 'paper',
  ): Promise<void> {
    const doc = await this.exportService.buildAssessmentDoc(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
      include === 'answers' ? 'teacher' : 'paper',
    );
    await this.send(
      res,
      doc,
      format,
      include === 'answers'
        ? `assessment-${assessmentId}-answer-key`
        : `assessment-${assessmentId}`,
    );
  }

  @Get('assessment/:assessmentId/preview')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async previewAssessment(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query('include', new ParseEnumPipe(EXPORT_INCLUDES, { optional: true }))
    include: (typeof EXPORT_INCLUDES)[number] = 'paper',
  ): Promise<PreviewPayload> {
    const doc = await this.exportService.buildAssessmentDoc(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
      include === 'answers' ? 'teacher' : 'paper',
    );
    return { preview: withHtml(buildPreview(doc)) };
  }

  /* Teacher-only result sheet: attempts ledger + aggregate analytics. This is
   * the ONLY assessment resource that exposes marks — never answer keys. */
  @Get('assessment/:assessmentId/results')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async exportAssessmentResults(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
  ): Promise<void> {
    const doc = await this.exportService.buildAssessmentResultsDoc(
      tenant.instituteId,
      assessmentId,
    );
    await this.send(res, doc, format, `assessment-${assessmentId}-results`);
  }

  @Get('assessment/:assessmentId/results/preview')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async previewAssessmentResults(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ): Promise<PreviewPayload> {
    const doc = await this.exportService.buildAssessmentResultsDoc(
      tenant.instituteId,
      assessmentId,
    );
    return { preview: withHtml(buildPreview(doc)) };
  }

  @Get('paper-pattern/:patternId')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async exportPaperPattern(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
  ): Promise<void> {
    const doc = await this.exportService.buildPaperPatternDoc(tenant.instituteId, patternId);
    await this.send(res, doc, format, `paper-pattern-${patternId}`);
  }

  @Get('paper-pattern/:patternId/preview')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async previewPaperPattern(
    @Tenant() tenant: TenantContext,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ): Promise<PreviewPayload> {
    const doc = await this.exportService.buildPaperPatternDoc(tenant.instituteId, patternId);
    return { preview: withHtml(buildPreview(doc)) };
  }

  @Get('question-paper/:paperId')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async exportQuestionPaper(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
    @Query('date') date?: string,
    @Query('time') time?: string,
  ): Promise<void> {
    const dateTime = date || time ? { date, time } : {};
    const doc = await this.exportService.buildQuestionPaperDoc(
      tenant.instituteId,
      paperId,
      dateTime,
    );
    await this.send(res, doc, format, `question-paper-${paperId}`);
  }

  @Get('question-paper/:paperId/preview')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async previewQuestionPaper(
    @Tenant() tenant: TenantContext,
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Query('date') date?: string,
    @Query('time') time?: string,
  ): Promise<PreviewPayload> {
    const dateTime = date || time ? { date, time } : {};
    const doc = await this.exportService.buildQuestionPaperDoc(
      tenant.instituteId,
      paperId,
      dateTime,
    );
    return { preview: withHtml(buildPreview(doc)) };
  }
}
