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
import { BadRequestException, UploadedFile } from '@nestjs/common';

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
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('paper-patterns')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class PaperPatternsController {
  constructor(
    private readonly paperPatternsService: PaperPatternsService,
    private readonly extraction: PaperPatternExtractionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaperPatternDto,
  ) {
    const pattern = await this.paperPatternsService.createPattern(
      tenant.instituteId,
      user.userId,
      dto,
    );
    return { pattern };
  }

  /** Extract a paper pattern from pasted source text. */
  @Post('extract-text')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
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
      ),
    };
  }

  /** Extract a paper pattern from an uploaded paper source (PDF or image).
   *  The file is OCR'd via the OCR service before the same deterministic
   *  extraction. */
  @Post('extract-file')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async extractFile(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A source file (PDF or image) is required');
    }
    return {
      extraction: await this.extraction.requestFileExtraction(
        tenant.instituteId,
        {
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
        },
        user.userId,
      ),
    };
  }

  @Get('extraction/:jobId')
  @RequiredRoles(...WRITE_ROLES)
  async extractionStatus(
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.extraction.getExtraction(tenant.instituteId, jobId);
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
  @RequiredRoles(...WRITE_ROLES)
  async list(@Tenant() tenant: TenantContext) {
    const patterns = await this.paperPatternsService.listPatterns(tenant.instituteId);
    return { patterns };
  }

  @Get(':patternId')
  @RequiredRoles(...WRITE_ROLES)
  async get(@Tenant() tenant: TenantContext, @Param('patternId', ParseUUIDPipe) patternId: string) {
    const pattern = await this.paperPatternsService.getPattern(tenant.instituteId, patternId);
    return { pattern };
  }

  @Patch(':patternId')
  @RequiredRoles(...WRITE_ROLES)
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: UpdatePaperPatternDto,
  ) {
    const pattern = await this.paperPatternsService.updatePattern(
      tenant.instituteId,
      user.userId,
      patternId,
      dto,
    );
    return { pattern };
  }

  @Delete(':patternId')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    return this.paperPatternsService.deletePattern(tenant.instituteId, patternId);
  }

  @Post(':patternId/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async analyze(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: AnalyzePaperPatternDto,
  ) {
    const generation = await this.paperPatternsService.analyze(
      tenant.instituteId,
      user.userId,
      patternId,
      dto.source,
    );
    return { generation };
  }

  @Get(':patternId/analyze/:jobId')
  @RequiredRoles(...WRITE_ROLES)
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
  @RequiredRoles(...WRITE_ROLES)
  async validate(
    @Tenant() tenant: TenantContext,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    return this.paperPatternsService.validate(tenant.instituteId, patternId);
  }

  @Post(':patternId/approve')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  async approve(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    const pattern = await this.paperPatternsService.approve(
      tenant.instituteId,
      user.userId,
      patternId,
    );
    return { pattern };
  }

  @Post(':patternId/unlock')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  async unlock(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    const pattern = await this.paperPatternsService.setLocked(
      tenant.instituteId,
      user.userId,
      patternId,
      false,
    );
    return { pattern };
  }

  @Post(':patternId/lock')
  @HttpCode(HttpStatus.OK)
  @RequiredRoles(...WRITE_ROLES)
  async lock(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    const pattern = await this.paperPatternsService.setLocked(
      tenant.instituteId,
      user.userId,
      patternId,
      true,
    );
    return { pattern };
  }

  @Post(':patternId/assessment')
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async createAssessment(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: CreateAssessmentFromBlueprintDto,
  ) {
    return this.paperPatternsService.createAssessmentFromBlueprint(
      tenant.instituteId,
      user.userId,
      patternId,
      dto,
    );
  }
}
