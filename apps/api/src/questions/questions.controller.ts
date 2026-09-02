import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { QuestionsService } from './questions.service.js';
import { CreateQuestionDto } from './dto/question.dto.js';
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
  constructor(private readonly questionsService: QuestionsService) {}

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
  async list(@Tenant() tenant: TenantContext) {
    const questions = await this.questionsService.listQuestions(tenant.instituteId);
    return { questions };
  }

  @Get(':questionId')
  async get(
    @Tenant() tenant: TenantContext,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    const question = await this.questionsService.getQuestion(tenant.instituteId, questionId);
    return { question };
  }
}