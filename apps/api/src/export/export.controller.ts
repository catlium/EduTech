import { Controller, Get, Param, Query, Res, UseGuards, ParseUUIDPipe, ParseEnumPipe } from '@nestjs/common';
import type { Response } from 'express';

import { ExportService } from './export.service.js';
import { sendDoc } from './export.renderers.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

const EXPORT_FORMATS = ['pdf', 'docx'] as const;

@Controller('export')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('content/:contentId')
  async exportContent(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
  ): Promise<void> {
    const doc = await this.exportService.buildContentDoc(tenant.instituteId, contentId);
    sendDoc(res, doc, format, `content-${contentId}`);
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
  ): Promise<void> {
    const doc = await this.exportService.buildQuestionsDoc(tenant.instituteId, {
      subjectId,
      chapterId,
      topicId,
    });
    sendDoc(res, doc, format, 'question-bank-export');
  }

  @Get('assessment/:assessmentId')
  async exportAssessment(
    @Tenant() tenant: TenantContext,
    @Res() res: Response,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query('format', new ParseEnumPipe(EXPORT_FORMATS, { optional: true }))
    format: (typeof EXPORT_FORMATS)[number] = 'pdf',
  ): Promise<void> {
    const doc = await this.exportService.buildAssessmentDoc(tenant.instituteId, assessmentId);
    sendDoc(res, doc, format, `assessment-${assessmentId}`);
  }
}