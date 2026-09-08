import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { AttemptsService } from './attempts.service.js';
import { StartAttemptDto, SaveAttemptAnswerDto } from './dto/attempts.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const TEACHER_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

/**
 * Student examination attempts. All student endpoints are member-scoped (the
 * student's own attempt only) — no answer-key data ever leaves the service.
 */
@Controller()
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class AttemptsController {
  constructor(private readonly attemptsService: AttemptsService) {}

  @Get('attempts/available')
  async listAvailable(@Tenant() tenant: TenantContext) {
    return this.attemptsService.listAvailable(tenant.instituteId);
  }

  @Post('attempts')
  @HttpCode(HttpStatus.CREATED)
  async start(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartAttemptDto,
  ) {
    return this.attemptsService.start(tenant.instituteId, user.userId, dto.assessmentId);
  }

  @Get('attempts/:attemptId')
  async get(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ) {
    return this.attemptsService.detail(tenant.instituteId, attemptId, user.userId);
  }

  @Put('attempts/:attemptId/questions/:attemptQuestionId')
  async save(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('attemptQuestionId', ParseUUIDPipe) attemptQuestionId: string,
    @Body() dto: SaveAttemptAnswerDto,
  ) {
    return this.attemptsService.saveResponse(
      tenant.instituteId,
      attemptId,
      user.userId,
      attemptQuestionId,
      dto.answer,
    );
  }

  @Post('attempts/:attemptId/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ) {
    const attempt = await this.attemptsService.submit(tenant.instituteId, attemptId, user.userId);
    return { attempt };
  }

  @Get('assessments/:assessmentId/attempts')
  @RequiredRoles(...TEACHER_ROLES)
  async listForAssessment(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    return this.attemptsService.listForAssessment(tenant.instituteId, assessmentId);
  }
}