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
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
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
/**
 *  * F5.5 — export guard migration (§13 `exports`). Every route here is a GET, so
 * they all take the single `exports.read` action, which TEACHER holds and
 * STUDENT does not — the same reachable set the legacy
 * `INSTITUTE_ADMIN`/`TEACHER` role gate gave on all twelve routes.
 *
 * TWO ROUTES STAY ROLE-GATED. `assessment/:assessmentId/results` and its
 * `preview` sibling build the attempts LEDGER plus aggregate analytics: other
 * students' marks across the whole cohort. No catalogued key can express that.
 * `exports.read` is a document-format capability, and `attempts.read` is held by
 * STUDENT too, so mapping either here would hand students the cohort ledger.
 * This is the same boundary F5.4 preserved on
 * `GET /assessments/:id/attempts` and `GET /assessments/:id/analytics`, and it
 * is protected by the identical regression test in
 * `remaining-surface-authz.integration.ts`. Do not migrate them to raise a
 * migration percentage.
 *
 * `ExportService` keeps every read gate it delegates to `ContentService`,
 * `ExaminationsService`, `PaperPatternsService` and `QuestionPapersService` —
 * the DRAFT-creator rule and the academic-scope 404s. This layer only says
 * "may this role request an export at all".

 */
@Controller('export')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
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
  @RequiredPermission('exports.read')
  async exportContent(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
  ): Promise<void> {
    const doc = await this.exportService.buildContentDoc(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      contentId,
    );
    await this.send(res, doc, format, `content-${contentId}`);
  }

  @Get('content/:contentId/preview')
  @RequiredPermission('exports.read')
  async previewContent(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ): Promise<PreviewPayload> {
    const doc = await this.exportService.buildContentDoc(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      contentId,
    );
    return { preview: withHtml(buildPreview(doc)) };
  }

  @Get('questions')
  @RequiredPermission('exports.read')
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
  @RequiredPermission('exports.read')
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
  @RequiredPermission('exports.read')
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
  @RequiredPermission('exports.read')
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
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
  ): Promise<void> {
    const doc = await this.exportService.buildAssessmentResultsDoc(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
    await this.send(res, doc, format, `assessment-${assessmentId}-results`);
  }

  @Get('assessment/:assessmentId/results/preview')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async previewAssessmentResults(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ): Promise<PreviewPayload> {
    const doc = await this.exportService.buildAssessmentResultsDoc(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
    return { preview: withHtml(buildPreview(doc)) };
  }

  @Get('paper-pattern/:patternId')
  @RequiredPermission('exports.read')
  async exportPaperPattern(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
  ): Promise<void> {
    const doc = await this.exportService.buildPaperPatternDoc(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
    );
    await this.send(res, doc, format, `paper-pattern-${patternId}`);
  }

  @Get('paper-pattern/:patternId/preview')
  @RequiredPermission('exports.read')
  async previewPaperPattern(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ): Promise<PreviewPayload> {
    const doc = await this.exportService.buildPaperPatternDoc(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
    );
    return { preview: withHtml(buildPreview(doc)) };
  }

  @Get('question-paper/:paperId')
  @RequiredPermission('exports.read')
  async exportQuestionPaper(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
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
      tenant.membershipId,
      user.userId,
      paperId,
      dateTime,
    );
    await this.send(res, doc, format, `question-paper-${paperId}`);
  }

  @Get('question-paper/:paperId/preview')
  @RequiredPermission('exports.read')
  async previewQuestionPaper(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Query('date') date?: string,
    @Query('time') time?: string,
  ): Promise<PreviewPayload> {
    const dateTime = date || time ? { date, time } : {};
    const doc = await this.exportService.buildQuestionPaperDoc(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      paperId,
      dateTime,
    );
    return { preview: withHtml(buildPreview(doc)) };
  }
}
