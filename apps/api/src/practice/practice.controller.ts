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
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

/**
 * Ungraded practice (Phase 13, PRAC-03). Open to any authenticated member —
 * sessions are always scoped to the caller's own institute and studentId, so
 * a user can only ever see or touch their own practice sessions. No
 * examination scoring/analytics integration anywhere in this module.
 */
@Controller()
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class PracticeController {
  constructor(private readonly practiceService: PracticeService) {}

  @Post('practice/sessions')
  @HttpCode(HttpStatus.CREATED)
  async start(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PracticeCreateDto,
  ) {
    return this.practiceService.start(tenant.instituteId, user.userId, dto);
  }

  @Get('practice/sessions')
  async history(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthenticatedUser) {
    return this.practiceService.history(tenant.instituteId, user.userId);
  }

  @Get('practice/sessions/:sessionId')
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
  async complete(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.practiceService.complete(tenant.instituteId, user.userId, sessionId);
  }
}