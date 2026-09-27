import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ParseEnumPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';

import { QuestionsService } from './questions.service.js';
import { QuestionGenerationService } from './question-generation.service.js';
import { CreateQuestionDto, UpdateQuestionDto } from './dto/question.dto.js';
import { GenerateQuestionsDto, BatchQuestionActionDto } from './dto/question-generation.dto.js';
import {
  GenerateBankDto,
  GenerateMoreDto,
  GenerateBankFromBlueprintDto,
  DeriveDistributionDto,
  QuestionBankScopeDto,
} from './dto/question-bank.dto.js';
import { buildBankBuckets, QUESTION_TYPES } from './build-bank-buckets.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

// Question Bank surface. F5.3: authorization is the permission catalogue's
// `questions` resource, not roles — INSTITUTE_ADMIN holds `questions.manage`
// through the built-in mapping (implying every action) and TEACHER holds
// read/create/update/delete, so both keep the whole surface. Every bank,
// generation, batch and extraction-candidate operation below declares exactly
// one key by operation, with no OR widening and no explicit `manage`.
// The service keeps institute + academic-scope + staging-ownership checks on
// every query; the permission check authorizes the operation, never replaces it.
@Controller('questions')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class QuestionsController {
  constructor(
    private readonly questionsService: QuestionsService,
    private readonly generationService: QuestionGenerationService,
  ) {}

  // ── CRUD ───────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('questions.create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuestionDto,
  ) {
    const question = await this.questionsService.createQuestion(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto,
    );
    return { question };
  }

  @Get()
  @RequiredPermission('questions.read')
  async list(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query('questionType') questionType?: string,
    @Query('difficulty', new ParseEnumPipe(['EASY', 'MEDIUM', 'HARD'], { optional: true }))
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD',
    @Query(
      'approvalStatus',
      new ParseEnumPipe(['PENDING', 'APPROVED', 'REJECTED'], { optional: true }),
    )
    approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED',
    @Query('q') q?: string,
    @Query('subjectId', new ParseUUIDPipe({ optional: true })) subjectId?: string,
    @Query('chapterId', new ParseUUIDPipe({ optional: true })) chapterId?: string,
    @Query('topicId', new ParseUUIDPipe({ optional: true })) topicId?: string,
  ) {
    const questions = await this.questionsService.listQuestions(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      {
        questionType,
        difficulty,
        approvalStatus,
        q,
        subjectId,
        chapterId,
        topicId,
      },
    );
    return { questions };
  }

  @Get(':questionId')
  @RequiredPermission('questions.read')
  async get(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.getQuestion(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      questionId,
    );
    return { question };
  }

  @Patch(':questionId')
  @RequiredPermission('questions.update')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    const question = await this.questionsService.updateQuestion(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      questionId,
      dto,
    );
    return { question };
  }

  @Delete(':questionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('questions.delete')
  async delete(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    await this.questionsService.deleteQuestion(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      questionId,
    );
  }

  // ── Legacy generation (backward compatible) ────────────────────────

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('questions.create')
  async generate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateQuestionsDto,
  ) {
    const generation = await this.generationService.requestGeneration(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto,
    );
    return { generation };
  }

  @Get('generate/:jobId')
  @RequiredPermission('questions.read')
  async getGeneration(
    @Tenant() tenant: TenantContext,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.generationService.getGenerationJob(tenant.instituteId, jobId);
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

  // ── Question bank ──────────────────────────────────────────────────

  @Post('bank/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('questions.create')
  async bankGenerate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateBankDto,
  ) {
    // Build (type, difficulty, count) buckets from the request config, or use
    // the explicit buckets supplied by the client (Create New Set).
    if (!dto.buckets && dto.count == null) {
      throw new BadRequestException('count is required when no explicit buckets are provided');
    }
    const buckets =
      dto.buckets ??
      buildBankBuckets({
        questionTypes: dto.questionTypes ?? QUESTION_TYPES,
        count: dto.count!,
        difficultyDistribution: dto.difficultyDistribution,
      });

    const generation = await this.generationService.requestBankGeneration(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      {
        subjectId: dto.subjectId,
        chapterId: dto.chapterId,
        topicId: dto.topicId,
        questionTypes: dto.questionTypes,
        count: dto.count ?? buckets.reduce((s: number, b) => s + b.count, 0),
        difficultyDistribution: dto.difficultyDistribution,
        blueprintId: dto.blueprintId,
      },
      buckets,
    );
    return { generation };
  }

  // ── Bank batch monitor (Goal E): one batch per generation request ──

  @Get('bank/batches/:batchId')
  @RequiredPermission('questions.read')
  async bankBatch(
    @Tenant() tenant: TenantContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    return this.generationService.getBankBatch(batchId, tenant.instituteId);
  }

  @Post('bank/batches/:batchId/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('questions.update')
  async cancelBankBatch(
    @Tenant() tenant: TenantContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    return this.generationService.cancelBankBatch(batchId, tenant.instituteId);
  }

  @Post('bank/batches/:batchId/retry-failed')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('questions.update')
  async retryFailedBankBatch(
    @Tenant() tenant: TenantContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    return this.generationService.retryFailedBankBatch(batchId, tenant.instituteId);
  }

  @Get('bank/sets')
  @RequiredPermission('questions.read')
  async bankSets(@Tenant() tenant: TenantContext) {
    return this.generationService.listBankSets(tenant.instituteId);
  }

  @Get('bank/stats')
  @RequiredPermission('questions.read')
  async bankStats(
    @Tenant() tenant: TenantContext,
    @Query('subjectId', new ParseUUIDPipe({ optional: true })) subjectId?: string,
    @Query('chapterId', new ParseUUIDPipe({ optional: true })) chapterId?: string,
    @Query('topicId', new ParseUUIDPipe({ optional: true })) topicId?: string,
  ) {
    const stats = await this.generationService.getBankStats(tenant.instituteId, tenant.membershipId, {
      subjectId,
      chapterId,
      topicId,
    });
    return { stats };
  }

  @Post('generate-more')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('questions.create')
  async generateMore(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateMoreDto,
  ) {
    const result = await this.generationService.computeDeficitsAndGenerateMore(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      {
        subjectId: dto.subjectId,
        chapterId: dto.chapterId,
        topicId: dto.topicId,
        buckets: dto.buckets,
        dryRun: dto.dryRun,
      },
    );
    return result;
  }

  @Post('bank/starter')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('questions.create')
  async bankStarter(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: QuestionBankScopeDto,
  ) {
    if (!dto.subjectId) {
      throw new BadRequestException('subjectId is required to generate starter questions');
    }
    const generation = await this.generationService.generateStarter(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto.subjectId,
    );
    return { generation };
  }

  @Post('bank/derive')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('questions.read')
  async deriveDistribution(@Tenant() tenant: TenantContext, @Body() dto: DeriveDistributionDto) {
    return this.generationService.deriveDistribution(
      tenant.instituteId,
      tenant.membershipId,
      { subjectId: dto.subjectId, chapterId: dto.chapterId, topicId: dto.topicId },
      dto.count,
    );
  }

  @Post('bank/generate-blueprint')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('questions.create')
  async bankGenerateFromBlueprint(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateBankFromBlueprintDto,
  ) {
    const generation = await this.generationService.generateFromBlueprint(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      {
        blueprintId: dto.blueprintId,
        subjectId: dto.subjectId,
        chapterId: dto.chapterId,
        topicId: dto.topicId,
      },
    );
    return { generation };
  }

  // ── Approval actions ───────────────────────────────────────────────

  @Post('batch-approve')
  @RequiredPermission('questions.update')
  async batchApprove(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthenticatedUser, @Body() dto: BatchQuestionActionDto) {
    const updated = await this.questionsService.batchSetApprovalStatus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto.questionIds,
      'APPROVED',
    );
    return { updated: updated.length, questionIds: updated };
  }

  @Post('batch-reject')
  @RequiredPermission('questions.update')
  async batchReject(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthenticatedUser, @Body() dto: BatchQuestionActionDto) {
    const updated = await this.questionsService.batchSetApprovalStatus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto.questionIds,
      'REJECTED',
    );
    return { updated: updated.length, questionIds: updated };
  }

  @Post(':questionId/approve')
  @RequiredPermission('questions.update')
  async approve(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.setApprovalStatus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      questionId,
      'APPROVED',
    );
    return { question };
  }

  @Post(':questionId/reject')
  @RequiredPermission('questions.update')
  async reject(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.setApprovalStatus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      questionId,
      'REJECTED',
    );
    return { question };
  }

  @Post(':questionId/archive')
  @RequiredPermission('questions.delete')
  async archive(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.setStatus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      questionId,
      'ARCHIVED',
    );
    return { question };
  }

  @Post(':questionId/activate')
  @RequiredPermission('questions.update')
  async activate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.setStatus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      questionId,
      'ACTIVE',
    );
    return { question };
  }
}
