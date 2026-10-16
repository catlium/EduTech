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
import { SetAssessmentScopeDto } from './dto/set-assessment-scope.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

// F5.4 — every route declares exactly one `assessments.*` key by operation
// (§13: read = list/detail, create = new instance, update = edit/transition,
// delete = remove from the active surface). The decorator authorizes the
// OPERATION; it never replaces the service gate below. `ExaminationsService`
// keeps institute scoping, the academic subject scope
// (`requireWritableSubject` / `gateAssessment`, O1 staging-by-creator for DRAFT
// and O2 pure-scope for finalized rows), and blueprint validation — so a fully
// authorized delegate still gets `NotFound` (never `Forbidden`) for another
// institute's assessment, an out-of-scope subject, or another teacher's DRAFT.
// RolesGuard stays in the chain as the architectural slot it has always had, and
// is now a no-op for every route here (no handler declares @RequiredRoles).
@Controller('assessments')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class ExaminationsController {
  constructor(private readonly examinationsService: ExaminationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('assessments.create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAssessmentDto,
  ) {
    const assessment = await this.examinationsService.createAssessment(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto,
    );
    return { assessment };
  }

  @Get()
  @RequiredPermission('assessments.read')
  async list(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthenticatedUser) {
    const assessments = await this.examinationsService.listAssessments(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
    );
    return { assessments };
  }

  @Get(':assessmentId')
  @RequiredPermission('assessments.read')
  async get(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const assessment = await this.examinationsService.getAssessment(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
    return { assessment };
  }

  @Patch(':assessmentId')
  @RequiredPermission('assessments.update')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: UpdateAssessmentDto,
  ) {
    const assessment = await this.examinationsService.updateAssessment(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
      dto,
    );
    return { assessment };
  }

  @Delete(':assessmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('assessments.delete')
  async delete(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    await this.examinationsService.deleteAssessment(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
  }

  @Patch(':assessmentId/scope')
  @RequiredPermission('assessments.update')
  async setScope(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: SetAssessmentScopeDto,
  ) {
    const assessment = await this.examinationsService.setScope(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
      dto,
    );
    return { assessment };
  }

  @Post(':assessmentId/publish')
  @RequiredPermission('assessments.update')
  async publish(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const assessment = await this.examinationsService.publishAssessment(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
    return { assessment };
  }

  @Post(':assessmentId/activate')
  @RequiredPermission('assessments.update')
  async activate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const assessment = await this.examinationsService.activateAssessment(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
    return { assessment };
  }

  @Post(':assessmentId/complete')
  @RequiredPermission('assessments.update')
  async complete(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const assessment = await this.examinationsService.completeAssessment(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
    return { assessment };
  }

  @Post(':assessmentId/unpublish')
  @RequiredPermission('assessments.update')
  async unpublish(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const assessment = await this.examinationsService.unpublishAssessment(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
    return { assessment };
  }

  @Get(':assessmentId/questions')
  @RequiredPermission('assessments.read')
  async listQuestions(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const questions = await this.examinationsService.listQuestions(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
    return { questions };
  }

  @Post(':assessmentId/questions')
  @RequiredPermission('assessments.update')
  async addQuestions(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: AddQuestionsDto,
  ) {
    const added = await this.examinationsService.addQuestions(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
      dto.questionIds,
      dto.marks,
      dto.sections,
    );
    return { added };
  }

  // Live per-section status against the assessment's paper pattern (Mode A or
  // Mode B manual selection). `coverage` is null when the assessment has no
  // blueprint — the client hides the pattern panel in that case.
  @Get(':assessmentId/pattern-coverage')
  @RequiredPermission('assessments.read')
  async patternCoverage(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const coverage = await this.examinationsService.getPatternCoverage(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
    return { coverage };
  }

  // Mode A — the system selects questions from the Question Bank for every
  // pattern section and appends them to this DRAFT assessment. Honest
  // shortages reported per section when the bank cannot satisfy the pattern.
  @Post(':assessmentId/select-from-pattern')
  @RequiredPermission('assessments.update')
  async selectFromPattern(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const result = await this.examinationsService.autoSelectFromPattern(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
    return { result };
  }

  @Delete(':assessmentId/questions/:questionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('assessments.delete')
  async removeQuestion(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    await this.examinationsService.removeQuestion(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
      questionId,
    );
  }
}
