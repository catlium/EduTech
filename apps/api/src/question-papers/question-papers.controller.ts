import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { QuestionPapersService } from './question-papers.service.js';
import {
  CreateQuestionPaperDto,
  RenameQuestionPaperDto,
  SetQuestionPaperScopeDto,
  GenerateMissingQuestionPaperDto,
} from './dto/question-papers.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('question-papers')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class QuestionPapersController {
  constructor(private readonly questionPapersService: QuestionPapersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuestionPaperDto,
  ) {
    return this.questionPapersService.createQuestionPaper(tenant.instituteId, user.userId, {
      patternId: dto.patternId,
      title: dto.title,
      description: dto.description,
      subjectId: dto.subjectId,
      chapterId: dto.chapterId,
      topicId: dto.topicId,
    });
  }

  @Get()
  @RequiredRoles(...WRITE_ROLES)
  async list(@Tenant() tenant: TenantContext) {
    const papers = await this.questionPapersService.listPapers(tenant.instituteId);
    return { papers };
  }

  @Get(':paperId')
  @RequiredRoles(...WRITE_ROLES)
  async get(@Tenant() tenant: TenantContext, @Param('paperId', ParseUUIDPipe) paperId: string) {
    const paper = await this.questionPapersService.getPaper(tenant.instituteId, paperId);
    return { paper };
  }

  @Patch(':paperId')
  @RequiredRoles(...WRITE_ROLES)
  async rename(
    @Tenant() tenant: TenantContext,
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Body() dto: RenameQuestionPaperDto,
  ) {
    const paper = await this.questionPapersService.renamePaper(
      tenant.instituteId,
      paperId,
      dto.title,
    );
    return { paper };
  }

  @Delete(':paperId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredRoles(...WRITE_ROLES)
  async delete(@Tenant() tenant: TenantContext, @Param('paperId', ParseUUIDPipe) paperId: string) {
    await this.questionPapersService.deletePaper(tenant.instituteId, paperId);
  }

  @Get(':paperId/questions')
  @RequiredRoles(...WRITE_ROLES)
  async listQuestions(
    @Tenant() tenant: TenantContext,
    @Param('paperId', ParseUUIDPipe) paperId: string,
  ) {
    const questions = await this.questionPapersService.listQuestions(tenant.instituteId, paperId);
    return { questions };
  }

  @Post(':paperId/select-from-pattern')
  @RequiredRoles(...WRITE_ROLES)
  async selectFromPattern(
    @Tenant() tenant: TenantContext,
    @Param('paperId', ParseUUIDPipe) paperId: string,
  ) {
    const result = await this.questionPapersService.autoSelectFromPattern(
      tenant.instituteId,
      paperId,
    );
    return { result };
  }

  @Get(':paperId/pattern-coverage')
  @RequiredRoles(...WRITE_ROLES)
  async patternCoverage(
    @Tenant() tenant: TenantContext,
    @Param('paperId', ParseUUIDPipe) paperId: string,
  ) {
    const coverage = await this.questionPapersService.getPatternCoverage(
      tenant.instituteId,
      paperId,
    );
    return { coverage };
  }

  @Patch(':paperId/scope')
  @RequiredRoles(...WRITE_ROLES)
  async setScope(
    @Tenant() tenant: TenantContext,
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Body() dto: SetQuestionPaperScopeDto,
  ) {
    const paper = await this.questionPapersService.setScope(tenant.instituteId, paperId, dto);
    return { paper };
  }

  @Post(':paperId/generate-missing')
  @RequiredRoles(...WRITE_ROLES)
  async generateMissing(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Body() dto: GenerateMissingQuestionPaperDto,
  ) {
    const result = await this.questionPapersService.generateMissing(
      tenant.instituteId,
      user.userId,
      paperId,
      dto.dryRun ?? false,
    );
    return { result };
  }

  @Post(':paperId/assessment')
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async createAssessment(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('paperId', ParseUUIDPipe) paperId: string,
  ) {
    const assessment = await this.questionPapersService.createAssessmentFromPaper(
      tenant.instituteId,
      user.userId,
      paperId,
    );
    return { assessment };
  }
}
