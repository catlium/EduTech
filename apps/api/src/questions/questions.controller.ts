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
} from '@nestjs/common';

import { QuestionsService } from './questions.service.js';
import { QuestionGenerationService } from './question-generation.service.js';
import { CreateQuestionDto, UpdateQuestionDto } from './dto/question.dto.js';
import {
  GenerateQuestionsDto,
  BatchQuestionActionDto,
} from './dto/question-generation.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('questions')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class QuestionsController {
  constructor(
    private readonly questionsService: QuestionsService,
    private readonly generationService: QuestionGenerationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuestionDto,
  ) {
    const question = await this.questionsService.createQuestion(
      tenant.instituteId,
      user.userId,
      dto,
    );
    return { question };
  }

  @Get()
  @RequiredRoles(...WRITE_ROLES)
  async list(
    @Tenant() tenant: TenantContext,
    @Query('questionType', new ParseEnumPipe(['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK'], { optional: true }))
    questionType?: 'MCQ' | 'TRUE_FALSE' | 'FILL_IN_BLANK',
    @Query('difficulty', new ParseEnumPipe(['EASY', 'MEDIUM', 'HARD'], { optional: true }))
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD',
    @Query('approvalStatus', new ParseEnumPipe(['PENDING', 'APPROVED', 'REJECTED'], { optional: true }))
    approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED',
    @Query('q') q?: string,
    @Query('subjectId', new ParseUUIDPipe({ optional: true })) subjectId?: string,
    @Query('chapterId', new ParseUUIDPipe({ optional: true })) chapterId?: string,
    @Query('topicId', new ParseUUIDPipe({ optional: true })) topicId?: string,
  ) {
    const questions = await this.questionsService.listQuestions(tenant.instituteId, {
      questionType,
      difficulty,
      approvalStatus,
      q,
      subjectId,
      chapterId,
      topicId,
    });
    return { questions };
  }

  @Get(':questionId')
  @RequiredRoles(...WRITE_ROLES)
  async get(
    @Tenant() tenant: TenantContext,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.getQuestion(tenant.instituteId, questionId);
    return { question };
  }

  @Patch(':questionId')
  @RequiredRoles(...WRITE_ROLES)
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    const question = await this.questionsService.updateQuestion(
      tenant.instituteId,
      user.userId,
      questionId,
      dto,
    );
    return { question };
  }

  @Delete(':questionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredRoles(...WRITE_ROLES)
  async delete(
    @Tenant() tenant: TenantContext,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    await this.questionsService.deleteQuestion(tenant.instituteId, questionId);
  }

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async generate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateQuestionsDto,
  ) {
    const generation = await this.generationService.requestGeneration(
      tenant.instituteId,
      user.userId,
      dto,
    );
    return { generation };
  }

  @Get('generate/:jobId')
  @RequiredRoles(...WRITE_ROLES)
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

  @Post('batch-approve')
  @RequiredRoles(...WRITE_ROLES)
  async batchApprove(
    @Tenant() tenant: TenantContext,
    @Body() dto: BatchQuestionActionDto,
  ) {
    const updated = await this.questionsService.batchSetApprovalStatus(
      tenant.instituteId,
      dto.questionIds,
      'APPROVED',
    );
    return { updated: updated.length, questionIds: updated };
  }

  @Post('batch-reject')
  @RequiredRoles(...WRITE_ROLES)
  async batchReject(
    @Tenant() tenant: TenantContext,
    @Body() dto: BatchQuestionActionDto,
  ) {
    const updated = await this.questionsService.batchSetApprovalStatus(
      tenant.instituteId,
      dto.questionIds,
      'REJECTED',
    );
    return { updated: updated.length, questionIds: updated };
  }

  @Post(':questionId/approve')
  @RequiredRoles(...WRITE_ROLES)
  async approve(
    @Tenant() tenant: TenantContext,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.setApprovalStatus(
      tenant.instituteId,
      questionId,
      'APPROVED',
    );
    return { question };
  }

  @Post(':questionId/reject')
  @RequiredRoles(...WRITE_ROLES)
  async reject(
    @Tenant() tenant: TenantContext,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.setApprovalStatus(
      tenant.instituteId,
      questionId,
      'REJECTED',
    );
    return { question };
  }

  @Post(':questionId/archive')
  @RequiredRoles(...WRITE_ROLES)
  async archive(
    @Tenant() tenant: TenantContext,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.setStatus(tenant.instituteId, questionId, 'ARCHIVED');
    return { question };
  }

  @Post(':questionId/activate')
  @RequiredRoles(...WRITE_ROLES)
  async activate(
    @Tenant() tenant: TenantContext,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.setStatus(tenant.instituteId, questionId, 'ACTIVE');
    return { question };
  }
}