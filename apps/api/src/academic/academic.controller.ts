import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { AcademicService } from './academic.service.js';
import {
  CreateSubjectDto,
  UpdateSubjectDto,
  CreateChapterDto,
  UpdateChapterDto,
  CreateTopicDto,
  UpdateTopicDto,
} from './dto/academic.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('academic')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class AcademicController {
  constructor(private readonly academicService: AcademicService) {}

  // ── Subjects ─────────────────────────────

  @Get('subjects')
  async listSubjects(@Tenant() tenant: TenantContext) {
    const subjects = await this.academicService.listSubjects(tenant.instituteId);
    return { subjects };
  }

  @Post('subjects')
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async createSubject(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateSubjectDto,
  ) {
    const subject = await this.academicService.createSubject(tenant.instituteId, dto);
    return { subject };
  }

  @Get('subjects/:subjectId')
  async getSubject(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    const subject = await this.academicService.getSubject(tenant.instituteId, subjectId);
    return { subject };
  }

  @Patch('subjects/:subjectId')
  @RequiredRoles(...WRITE_ROLES)
  async updateSubject(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    const subject = await this.academicService.updateSubject(tenant.instituteId, subjectId, dto);
    return { subject };
  }

  // ── Chapters ─────────────────────────────

  @Get('subjects/:subjectId/chapters')
  async listChapters(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    const chapters = await this.academicService.listChapters(tenant.instituteId, subjectId);
    return { chapters };
  }

  @Post('subjects/:subjectId/chapters')
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async createChapter(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: CreateChapterDto,
  ) {
    const chapter = await this.academicService.createChapter(
      tenant.instituteId,
      subjectId,
      dto,
    );
    return { chapter };
  }

  @Get('chapters/:chapterId')
  async getChapter(
    @Tenant() tenant: TenantContext,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
  ) {
    const chapter = await this.academicService.getChapter(tenant.instituteId, chapterId);
    return { chapter };
  }

  @Patch('chapters/:chapterId')
  @RequiredRoles(...WRITE_ROLES)
  async updateChapter(
    @Tenant() tenant: TenantContext,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: UpdateChapterDto,
  ) {
    const chapter = await this.academicService.updateChapter(tenant.instituteId, chapterId, dto);
    return { chapter };
  }

  // ── Topics ───────────────────────────────

  @Get('chapters/:chapterId/topics')
  async listTopics(
    @Tenant() tenant: TenantContext,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
  ) {
    const topics = await this.academicService.listTopics(tenant.instituteId, chapterId);
    return { topics };
  }

  @Post('chapters/:chapterId/topics')
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async createTopic(
    @Tenant() tenant: TenantContext,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: CreateTopicDto,
  ) {
    const topic = await this.academicService.createTopic(tenant.instituteId, chapterId, dto);
    return { topic };
  }

  @Get('topics/:topicId')
  async getTopic(
    @Tenant() tenant: TenantContext,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    const topic = await this.academicService.getTopic(tenant.instituteId, topicId);
    return { topic };
  }

  @Patch('topics/:topicId')
  @RequiredRoles(...WRITE_ROLES)
  async updateTopic(
    @Tenant() tenant: TenantContext,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Body() dto: UpdateTopicDto,
  ) {
    const topic = await this.academicService.updateTopic(tenant.instituteId, topicId, dto);
    return { topic };
  }
}