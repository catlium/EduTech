import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BadRequestException, Headers, UploadedFile } from '@nestjs/common';

import { PaperPatternsService } from './paper-patterns.service.js';
import { PaperPatternExtractionService } from './paper-pattern-extraction.service.js';
import {
  AnalyzePaperPatternDto,
  CreateAssessmentFromBlueprintDto,
  CreatePaperPatternDto,
  ExtractTextDto,
  UpdatePaperPatternDto,
} from './paper-patterns.dto.js';
import { MAX_FILE_SIZE } from '../materials/materials.constants.js';
import { UploadChunksService } from '../materials/upload-chunks.service.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

// Paper-pattern surface. F5.3: the catalogue's `paper-patterns` resource, per
// §13 — CRUD by operation, source extraction→create, analyze/lock/unlock/
// approve→update, validate→read (it gates with the service's read policy).
// F5.4 resolved the deferred `/:patternId/assessment` bridge: it creates an
// `assessments` row, so it declares `assessments.create` — the same key
// `POST /assessments` requires, not `paper-patterns.create` (which would let a
// pattern author mint examinations they have no authority to create). The
// service's `gatePatternAccess` subject-set, staging-ownership and admin-only
// subject-less checks, plus `ensurePatternCoverage` and
// `createAssessment`'s own `requireWritableSubject`, are untouched and still run
// behind the permission check.
@Controller('paper-patterns')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class PaperPatternsController {
  constructor(
    private readonly paperPatternsService: PaperPatternsService,
    private readonly extraction: PaperPatternExtractionService,
    private readonly chunks: UploadChunksService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('paper-patterns.create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaperPatternDto,
  ) {
    const pattern = await this.paperPatternsService.createPattern(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto,
    );
    return { pattern };
  }

  /** Extract a paper pattern from pasted source text. */
  @Post('extract-text')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('paper-patterns.create')
  async extractText(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ExtractTextDto,
  ) {
    return {
      extraction: await this.extraction.requestTextExtraction(
        tenant.instituteId,
        dto.text,
        user.userId,
        tenant.membershipId,
      ),
    };
  }

  /** Extract a paper pattern from an uploaded paper source (PDF or image).
   *  The file is OCR'd via the OCR service before the same deterministic
   *  extraction. */
  @Post('extract-file')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('paper-patterns.create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async extractFile(
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
      extraction: await this.extraction.requestFileExtraction(
        tenant.instituteId,
        { buffer, originalname: file.originalname, mimetype: file.mimetype },
        user.userId,
        tenant.membershipId,
      ),
    };
  }

  @Get('extraction/:jobId')
  @RequiredPermission('paper-patterns.read')
  async extractionStatus(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.extraction.getExtraction(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      jobId,
    );
    return {
      extraction: {
        jobId: job.id,
        status: job.status,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      },
    };
  }

  @Get()
  @RequiredPermission('paper-patterns.read')
  async list(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthenticatedUser) {
    const patterns = await this.paperPatternsService.listPatterns(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
    );
    return { patterns };
  }

  @Get(':patternId')
  @RequiredPermission('paper-patterns.read')
  async get(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    const pattern = await this.paperPatternsService.getPattern(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
    );
    return { pattern };
  }

  @Patch(':patternId')
  @RequiredPermission('paper-patterns.update')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: UpdatePaperPatternDto,
  ) {
    const pattern = await this.paperPatternsService.updatePattern(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
      dto,
    );
    return { pattern };
  }

  @Delete(':patternId')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('paper-patterns.delete')
  async remove(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    return this.paperPatternsService.deletePattern(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
    );
  }

  @Post(':patternId/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('paper-patterns.update')
  async analyze(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: AnalyzePaperPatternDto,
  ) {
    const generation = await this.paperPatternsService.analyze(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
      dto.source,
    );
    return { generation };
  }

  @Get(':patternId/analyze/:jobId')
  @RequiredPermission('paper-patterns.read')
  async getAnalysis(
    @Tenant() tenant: TenantContext,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.paperPatternsService.getAnalysisJob(
      tenant.instituteId,
      patternId,
      jobId,
    );
    return {
      generation: {
        jobId: job.id,
        operation: job.type,
        status: job.status,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      },
    };
  }

  @Post(':patternId/validate')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('paper-patterns.read')
  async validate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    return this.paperPatternsService.validate(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
    );
  }

  @Post(':patternId/approve')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('paper-patterns.update')
  async approve(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    const pattern = await this.paperPatternsService.approve(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
    );
    return { pattern };
  }

  @Post(':patternId/unlock')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('paper-patterns.update')
  async unlock(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    const pattern = await this.paperPatternsService.setLocked(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
      false,
    );
    return { pattern };
  }

  @Post(':patternId/lock')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('paper-patterns.update')
  async lock(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    const pattern = await this.paperPatternsService.setLocked(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
      true,
    );
    return { pattern };
  }

  @Post(':patternId/assessment')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('assessments.create')
  async createAssessment(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: CreateAssessmentFromBlueprintDto,
  ) {
    return this.paperPatternsService.createAssessmentFromBlueprint(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      patternId,
      dto,
    );
  }
}
