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
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const TEACHER_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

/**
 * Student examination attempts. All student endpoints are member-scoped (the
 * student's own attempt only) — no answer-key data ever leaves the service.
 *
 * F5.4 — the self-scoped routes declare exactly one `attempts.*` key by
 * operation (§13). This narrows, never widens: STUDENT already holds
 * attempts.read/create/update, so every student learning route keeps working,
 * while a membership with no grant (or a TEACHER, which holds only
 * attempts.read) is now default-denied instead of walking in. The service still
 * answers ownership — `loadOwn` matches institute + studentId, so a delegate
 * can only ever reach their own attempt — and MOD-4's assessment gate is
 * untouched: the two teacher endpoints below resolve the assessment through
 * `ExaminationsService.getAssessment`.
 */
@Controller()
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class AttemptsController {
  constructor(private readonly attemptsService: AttemptsService) {}

  @Get('attempts/available')
  @RequiredPermission('attempts.read')
  async listAvailable(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthenticatedUser) {
    return this.attemptsService.listAvailable(tenant.instituteId, user.userId);
  }

  @Get('attempts')
  @RequiredPermission('attempts.read')
  async history(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthenticatedUser) {
    return this.attemptsService.listMine(tenant.instituteId, user.userId);
  }

  @Post('attempts')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('attempts.create')
  async start(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartAttemptDto,
  ) {
    return this.attemptsService.start(tenant.instituteId, user.userId, dto.assessmentId);
  }

  @Get('attempts/:attemptId')
  @RequiredPermission('attempts.read')
  async get(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ) {
    return this.attemptsService.detail(tenant.instituteId, attemptId, user.userId);
  }

  @Put('attempts/:attemptId/questions/:attemptQuestionId')
  @RequiredPermission('attempts.update')
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
  @RequiredPermission('attempts.update')
  async submit(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ) {
    const attempt = await this.attemptsService.submit(tenant.instituteId, attemptId, user.userId);
    return { attempt };
  }

  @Get('attempts/:attemptId/result')
  @RequiredPermission('attempts.read')
  async result(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ) {
    return this.attemptsService.result(tenant.instituteId, attemptId, user.userId);
  }

  // INTENTIONALLY ROLE-GATED (F5.4 audit, §13): the attempt LEDGER exposes other
  // students' attempts, and no catalogued key can express "may read someone
  // else's attempt" — `attempts.read` is held by STUDENT too, and a placed
  // STUDENT's academic scope (AcademicScopeService.resolveScope) covers their
  // own subjects, so the MOD-4 `getAssessment` gate would let them read the whole
  // cohort. RolesGuard is the only thing standing between them and that data, so
  // it stays. A future dedicated key (e.g. an oversight action) is a catalogue
  // decision for a later phase, not a guard-migration detail.
  @Get('assessments/:assessmentId/attempts')
  @RequiredRoles(...TEACHER_ROLES)
  async listForAssessment(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    return this.attemptsService.listForAssessment(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
  }

  // INTENTIONALLY ROLE-GATED — same reason as `assessments/:id/attempts` above.
  @Get('assessments/:assessmentId/analytics')
  @RequiredRoles(...TEACHER_ROLES)
  async analytics(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    return this.attemptsService.getAnalytics(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      assessmentId,
    );
  }
}
