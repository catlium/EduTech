import { Controller, Get, Post, HttpCode, HttpStatus, Body, UseGuards } from '@nestjs/common';

import { QuestionTypesService } from './question-types.service.js';
import { CreateQuestionTypeDto } from './dto/create-question-type.dto.js';
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

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

// Question-type config. `question_types` is an institute-wide config surface
// (§18.1) with a two-key catalogue (`read`, `manage`) — STUDENT and TEACHER
// already hold `question-types.read`, so the list route maps to it exactly and
// no built-in role changes. The create route stays @RequiredRoles: the catalogue
// has no `question-types.create`, and mapping it onto `question-types.manage`
// would silently strip TEACHER's existing ability to add a custom type (F5.3
// catalogue gap, reported rather than invented).
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
  @RequiredRoles(...WRITE_ROLES)
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuestionTypeDto,
  ) {
    const type = await this.typesService.create(tenant.instituteId, user.userId, dto);
    return { type };
  }
}
