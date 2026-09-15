import {
  ConflictException,
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  ParseUUIDPipe,
  ParseEnumPipe,
} from '@nestjs/common';
import type { Response } from 'express';

import { ExportService } from './export.service.js';
import { buildPreview, docDigest } from './export.content-blocks.js';
import type { DocumentModel } from './export.content-blocks.js';
import { sendDoc } from './export.renderers.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

const EXPORT_FORMATS = ['pdf', 'docx'] as const;
const EXPORT_INCLUDES = ['paper', 'answers'] as const;

/* Every export requires a preview first: the server re-builds the document
 * and compares the previewHash the client gives back. A missing or stale
 * hash → 409 Conflict, so PDF/DOCX can never be produced straight from a
 * selection/generation screen (and the file always matches the preview). */
@Controller('export')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  private sendVerified(
    res: Response,
    document: DocumentModel,
    format: (typeof EXPORT_FORMATS)[number],
    filename: string,
    previewHash: string | undefined,
  ): void {
    if (!previewHash || docDigest(document) !== previewHash) {
      throw new ConflictException(
        'This export is stale or was never previewed — preview the current selection first',
      );
    }
    sendDoc(res, document, format, filename);
  }

  @Get('content/:contentId')
  async exportContent(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
    @Query('previewHash') previewHash?: string,
  ): Promise<void> {
    const doc = await this.exportService.buildContentDoc(tenant.instituteId, contentId);
    this.sendVerified(res, doc, format, `content-${contentId}`, previewHash);
  }

  @Get('content/:contentId/preview')
  async previewContent(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ): Promise<{ preview: ReturnType<typeof buildPreview> }> {
    const doc = await this.exportService.buildContentDoc(tenant.instituteId, contentId);
    return { preview: buildPreview(doc) };
  }

  @Get('questions')
  async exportQuestions(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
    @Query('subjectId') subjectId?: string,
    @Query('chapterId') chapterId?: string,
    @Query('topicId') topicId?: string,
    @Query('previewHash') previewHash?: string,
  ): Promise<void> {
    const doc = await this.exportService.buildQuestionsDoc(tenant.instituteId, {
      subjectId,
      chapterId,
      topicId,
    });
    this.sendVerified(res, doc, format, 'question-bank-export', previewHash);
  }

  @Get('questions/preview')
  async previewQuestions(
    @Tenant() tenant: TenantContext,
    @Query('subjectId') subjectId?: string,
    @Query('chapterId') chapterId?: string,
    @Query('topicId') topicId?: string,
  ): Promise<{ preview: ReturnType<typeof buildPreview> }> {
    const doc = await this.exportService.buildQuestionsDoc(tenant.instituteId, {
      subjectId,
      chapterId,
      topicId,
    });
    return { preview: buildPreview(doc) };
  }

  @Get('assessment/:assessmentId')
  async exportAssessment(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
    // Paper = student-facing (no answers/difficulty), answers = teacher key.
    @Query('include', new ParseEnumPipe(EXPORT_INCLUDES, { optional: true }))
    include: (typeof EXPORT_INCLUDES)[number] = 'paper',
    @Query('previewHash') previewHash?: string,
  ): Promise<void> {
    const doc = await this.exportService.buildAssessmentDoc(
      tenant.instituteId,
      assessmentId,
      include === 'answers' ? 'teacher' : 'paper',
    );
    this.sendVerified(
      res,
      doc,
      format,
      include === 'answers'
        ? `assessment-${assessmentId}-answer-key`
        : `assessment-${assessmentId}`,
      previewHash,
    );
  }

  @Get('assessment/:assessmentId/preview')
  async previewAssessment(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query('include', new ParseEnumPipe(EXPORT_INCLUDES, { optional: true }))
    include: (typeof EXPORT_INCLUDES)[number] = 'paper',
  ): Promise<{ preview: ReturnType<typeof buildPreview> }> {
    const doc = await this.exportService.buildAssessmentDoc(
      tenant.instituteId,
      assessmentId,
      include === 'answers' ? 'teacher' : 'paper',
    );
    return { preview: buildPreview(doc) };
  }

  @Get('paper-pattern/:patternId')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async exportPaperPattern(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
    @Query('previewHash') previewHash?: string,
  ): Promise<void> {
    const doc = await this.exportService.buildPaperPatternDoc(tenant.instituteId, patternId);
    this.sendVerified(res, doc, format, `paper-pattern-${patternId}`, previewHash);
  }

  @Get('paper-pattern/:patternId/preview')
  @RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')
  async previewPaperPattern(
    @Tenant() tenant: TenantContext,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ): Promise<{ preview: ReturnType<typeof buildPreview> }> {
    const doc = await this.exportService.buildPaperPatternDoc(tenant.instituteId, patternId);
    return { preview: buildPreview(doc) };
  }
}