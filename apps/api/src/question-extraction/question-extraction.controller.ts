import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { QuestionExtractionService } from './question-extraction.service.js';
import { ExtractQuestionsDto, ReviewQuestionCandidateDto } from './dto/question-extraction.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

/** The extraction status poll shape (mirrors paper-pattern extraction). */
function toStatus(job: {
  id: string;
  status: string;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}) {
  return {
    extraction: {
      jobId: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
    },
  };
}

@Controller('questions')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class QuestionExtractionController {
  constructor(private readonly extractionService: QuestionExtractionService) {}

  @Post('extract-from-material')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async extract(
    @Tenant() tenant: TenantContext,
    @Body() dto: ExtractQuestionsDto,
  ) {
    const extraction = await this.extractionService.requestExtraction(tenant.instituteId, dto);
    return { extraction };
  }

  @Get('extraction/:jobId')
  @RequiredRoles(...WRITE_ROLES)
  async status(
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return toStatus(await this.extractionService.getExtraction(tenant.instituteId, jobId));
  }

  @Get('extraction/:jobId/candidates')
  @RequiredRoles(...WRITE_ROLES)
  async candidates(
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const { meta, candidates } = await this.extractionService.listCandidates(
      tenant.instituteId,
      jobId,
    );
    return {
      extraction: meta,
      candidates,
    };
  }

  @Patch('extraction/:jobId/candidates/:questionId')
  @RequiredRoles(...WRITE_ROLES)
  async updateCandidate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: ReviewQuestionCandidateDto,
  ) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No editable fields were provided');
    }
    const question = await this.extractionService.updateCandidate(
      tenant.instituteId,
      user.userId,
      jobId,
      questionId,
      dto,
    );
    return { question };
  }

  @Post('extraction/:jobId/candidates/:questionId/accept')
  @RequiredRoles(...WRITE_ROLES)
  async acceptCandidate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.extractionService.acceptCandidate(
      tenant.instituteId,
      user.userId,
      jobId,
      questionId,
    );
    return { question };
  }

  @Post('extraction/:jobId/candidates/:questionId/discard')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredRoles(...WRITE_ROLES)
  async discardCandidate(
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    await this.extractionService.discardCandidate(tenant.instituteId, jobId, questionId);
  }

  @Post('extraction/:jobId/import')
  @RequiredRoles(...WRITE_ROLES)
  async importAll(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.extractionService.importAll(tenant.instituteId, user.userId, jobId);
  }

  @Post('extraction/:jobId/discard')
  @RequiredRoles(...WRITE_ROLES)
  async discardAll(
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.extractionService.discardAll(tenant.instituteId, jobId);
  }
}