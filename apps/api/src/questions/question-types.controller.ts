import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  Body,
  UseGuards,
} from '@nestjs/common';

import { QuestionTypesService } from './question-types.service.js';
import { CreateQuestionTypeDto } from './dto/create-question-type.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('question-types')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class QuestionTypesController {
  constructor(private readonly typesService: QuestionTypesService) {}

  @Get()
  @RequiredRoles('STUDENT', 'PARENT', ...WRITE_ROLES)
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