import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { ExaminationsService } from './examinations.service.js';
import { CreateAssessmentDto } from './dto/create-assessment.dto.js';
import { UpdateAssessmentDto } from './dto/update-assessment.dto.js';
import { AddQuestionsDto } from './dto/add-questions.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('assessments')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class ExaminationsController {
  constructor(private readonly examinationsService: ExaminationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAssessmentDto,
  ) {
    const assessment = await this.examinationsService.createAssessment(
      tenant.instituteId,
      user.userId,
      dto,
    );
    return { assessment };
  }

  @Get()
  async list(@Tenant() tenant: TenantContext) {
    const assessments = await this.examinationsService.listAssessments(tenant.instituteId);
    return { assessments };
  }

  @Get(':assessmentId')
  async get(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const assessment = await this.examinationsService.getAssessment(
      tenant.instituteId,
      assessmentId,
    );
    return { assessment };
  }

  @Patch(':assessmentId')
  @RequiredRoles(...WRITE_ROLES)
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: UpdateAssessmentDto,
  ) {
    const assessment = await this.examinationsService.updateAssessment(
      tenant.instituteId,
      user.userId,
      assessmentId,
      dto,
    );
    return { assessment };
  }

  @Delete(':assessmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredRoles(...WRITE_ROLES)
  async delete(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    await this.examinationsService.deleteAssessment(tenant.instituteId, assessmentId);
  }

  @Get(':assessmentId/questions')
  async listQuestions(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const questions = await this.examinationsService.listQuestions(
      tenant.instituteId,
      assessmentId,
    );
    return { questions };
  }

  @Post(':assessmentId/questions')
  @RequiredRoles(...WRITE_ROLES)
  async addQuestions(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: AddQuestionsDto,
  ) {
    const added = await this.examinationsService.addQuestions(
      tenant.instituteId,
      assessmentId,
      dto.questionIds,
    );
    return { added };
  }

  @Delete(':assessmentId/questions/:questionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredRoles(...WRITE_ROLES)
  async removeQuestion(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    await this.examinationsService.removeQuestion(
      tenant.instituteId,
      assessmentId,
      questionId,
    );
  }
}