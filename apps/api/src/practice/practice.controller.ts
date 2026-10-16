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

import { PracticeService } from './practice.service.js';
import { PracticeCreateDto, PracticeSaveAnswerDto } from './dto/practice.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

/**
 * Ungraded practice (Phase 13, PRAC-03). Open to any authenticated member —
 * sessions are always scoped to the caller's own institute and studentId, so
 * a user can only ever see or touch their own practice sessions. No
 * examination scoring/analytics integration anywhere in this module.
 *
 * F5.4 — the routes were the last unguarded (no @RequiredRoles) surface; each
 * now declares exactly one `practice.*` key by operation (§13). This is a
 * tightening that matches the shipped capability rather than changing it: the
 * `/practice` nav entry is shared by teachers and students (`sharedNav` in
 * app-sidebar.tsx) and the routes never carried a role gate, so TEACHER's
 * recorded defaults gained `practice.create`/`practice.update` in the same
 * commit — a teacher can start, answer and complete exactly as before, and
 * STUDENT (which already held all three) is unaffected. `loadOwn` still matches
 * institute + studentId, so the permission authorizes the operation and the
 * service still authorizes the session.
 */
@Controller()
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class PracticeController {
  constructor(private readonly practiceService: PracticeService) {}

  @Post('practice/sessions')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('practice.create')
  async start(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PracticeCreateDto,
  ) {
    return this.practiceService.start(tenant.instituteId, user.userId, dto);
  }

  @Get('practice/sessions')
  @RequiredPermission('practice.read')
  async history(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthenticatedUser) {
    return this.practiceService.history(tenant.instituteId, user.userId);
  }

  @Get('practice/sessions/:sessionId')
  @RequiredPermission('practice.read')
  async get(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return {
      session: await this.practiceService.detail(tenant.instituteId, user.userId, sessionId),
    };
  }

  @Put('practice/sessions/:sessionId/items/:sessionItemId')
  @RequiredPermission('practice.update')
  async save(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('sessionItemId', ParseUUIDPipe) sessionItemId: string,
    @Body() dto: PracticeSaveAnswerDto,
  ) {
    return this.practiceService.answer(
      tenant.instituteId,
      user.userId,
      sessionId,
      sessionItemId,
      dto,
    );
  }

  @Post('practice/sessions/:sessionId/complete')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('practice.update')
  async complete(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.practiceService.complete(tenant.instituteId, user.userId, sessionId);
  }
}
