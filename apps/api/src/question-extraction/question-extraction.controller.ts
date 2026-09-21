import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { QuestionExtractionService } from './question-extraction.service.js';
import { ExtractQuestionsDto, ReviewQuestionCandidateDto } from './dto/question-extraction.dto.js';
import { QuestionPaperExtractionService } from '../question-papers/question-paper-extraction.service.js';
import { ExtractQuestionPaperTextDto } from '../question-papers/dto/question-papers.dto.js';
import { UploadChunksService } from '../materials/upload-chunks.service.js';
import { MAX_FILE_SIZE } from '../materials/materials.constants.js';
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
  constructor(
    private readonly extractionService: QuestionExtractionService,
    private readonly sourceExtraction: QuestionPaperExtractionService,
    private readonly chunks: UploadChunksService,
  ) {}

  @Post('extract-from-material')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async extract(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ExtractQuestionsDto,
  ) {
    const extraction = await this.extractionService.requestExtraction(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto,
    );
    return { extraction };
  }

  /** Independent Question Bank extraction from pasted exam-paper text — the
   *  same deterministic extractor, but candidates land in the Bank REVIEW tray
   *  (no Question Paper is created). */
  @Post('extract-source-text')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async extractSourceText(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ExtractQuestionPaperTextDto,
  ) {
    return {
      extraction: await this.sourceExtraction.requestTextExtraction(
        tenant.instituteId,
        dto.text,
        user.userId,
      ),
    };
  }

  /** Independent Question Bank extraction from an uploaded paper PDF/image. */
  @Post('extract-source-file')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async extractSourceFile(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
    @Headers('x-upload-id') uploadId?: string,
    @Headers('x-chunk-index') chunkIndex?: string,
    @Headers('x-chunk-total') chunkTotal?: string,
  ) {
    if (!file) {
      throw new BadRequestException('A source file (PDF or image) is required');
    }
    const chunk = this.chunks.parse(uploadId, chunkIndex, chunkTotal);
    let buffer = file.buffer;
    if (chunk) {
      const assembled = await this.chunks.acceptOrAssemble(chunk, tenant.instituteId, file.buffer);
      if (assembled === null) {
        return { chunk: { index: chunk.index, total: chunk.total } };
      }
      buffer = assembled;
    }
    if (buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException(`File exceeds the ${MAX_FILE_SIZE / (1024 * 1024)} MB limit`);
    }
    return {
      extraction: await this.sourceExtraction.requestFileExtraction(
        tenant.instituteId,
        { buffer, originalname: file.originalname, mimetype: file.mimetype },
        user.userId,
      ),
    };
  }

  @Get('extraction/:jobId')
  @RequiredRoles(...WRITE_ROLES)
  async status(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return toStatus(
      await this.extractionService.getExtraction(
        tenant.instituteId,
        tenant.membershipId,
        user.userId,
        jobId,
      ),
    );
  }

  @Get('extraction/:jobId/candidates')
  @RequiredRoles(...WRITE_ROLES)
  async candidates(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const { meta, candidates } = await this.extractionService.listCandidates(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
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
      tenant.membershipId,
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
      tenant.membershipId,
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
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    await this.extractionService.discardCandidate(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      jobId,
      questionId,
    );
  }

  @Post('extraction/:jobId/import')
  @RequiredRoles(...WRITE_ROLES)
  async importAll(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.extractionService.importAll(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      jobId,
    );
  }

  @Post('extraction/:jobId/discard')
  @RequiredRoles(...WRITE_ROLES)
  async discardAll(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.extractionService.discardAll(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      jobId,
    );
  }
}