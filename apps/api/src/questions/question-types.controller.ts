import { Controller, Get, Post, HttpCode, HttpStatus, Body, UseGuards } from '@nestjs/common';

import { QuestionTypesService } from './question-types.service.js';
import { CreateQuestionTypeDto } from './dto/create-question-type.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

// Question-type config. `question_types` is an institute-wide config surface
// (§18.1). F5.4 resolved the F5.3 catalogue gap: the resource performs exactly
// one mutation, so `create` is now catalogued alongside `read`/`manage` (no
// `update`/`delete` — no such endpoint exists). Repointing at `question-types.
// manage` was rejected because it would have revoked TEACHER's existing
// capability (TEACHER holds `read` only), and `read` may not imply `create`.
// The teacher custom-type panel keeps working through the new default grant
// (TEACHER gained `question-types.create`; STUDENT is untouched and still
// read-only), so enforcement moved from role names to grants with no behaviour
// change. No @RequiredRoles remains on this controller.
@Controller('question-types')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class QuestionTypesController {
  constructor(private readonly typesService: QuestionTypesService) {}

  @Get()
  @RequiredPermission('question-types.read')
  async list(@Tenant() tenant: TenantContext) {
    const types = await this.typesService.list(tenant.instituteId);
    return { types };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('question-types.create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuestionTypeDto,
  ) {
    const type = await this.typesService.create(tenant.instituteId, user.userId, dto);
    return { type };
  }
}
