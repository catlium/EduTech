import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

/**
 * F5.5 — subject / chapter / topic guard migration (§13). This controller
 * shares the `academic` prefix with `AcademicStructureController` (F5.2,
 * `academic-structure.*`) but owns a different surface, so it keys on the
 * `subjects` / `chapters` / `topics` resources the catalogue already defines,
 * and both TEACHER and STUDENT already hold at the recorded defaults.
 *
 * Nothing is widened: the eight reads that carried NO role gate were reachable
 * by every member, and all three resources grant `read` to TEACHER and STUDENT,
 * so each read still resolves exactly as before. The eight writes that required
 * the legacy `INSTITUTE_ADMIN`/`TEACHER` gate map one-to-one onto
 * create/update/delete — which TEACHER holds and STUDENT does not. No `manage`
 * is declared; a `R.manage` grantee is satisfied by implication in the grant
 * layer. `AcademicService` still answers institute scoping on every query; this
 * layer only says "may this role perform the action at all".
 */
@Controller('academic')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class AcademicController {
  constructor(private readonly academicService: AcademicService) {}

  // ── Subjects ─────────────────────────────

  @Get('subjects')
  @RequiredPermission('subjects.read')
  async listSubjects(@Tenant() tenant: TenantContext) {
    const subjects = await this.academicService.listSubjects(tenant.instituteId);
    return { subjects };
  }

  @Get('subjects/deleted')
  @RequiredPermission('subjects.read')
  async listDeletedSubjects(@Tenant() tenant: TenantContext) {
    const subjects = await this.academicService.listDeletedSubjects(tenant.instituteId);
    return { subjects };
  }

  @Post('subjects')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('subjects.create')
  async createSubject(@Tenant() tenant: TenantContext, @Body() dto: CreateSubjectDto) {
    const subject = await this.academicService.createSubject(tenant.instituteId, dto);
    return { subject };
  }

  @Get('subjects/:subjectId')
  @RequiredPermission('subjects.read')
  async getSubject(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    const subject = await this.academicService.getSubject(tenant.instituteId, subjectId);
    return { subject };
  }

  @Patch('subjects/:subjectId')
  @RequiredPermission('subjects.update')
  async updateSubject(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    const subject = await this.academicService.updateSubject(tenant.instituteId, subjectId, dto);
    return { subject };
  }

  @Delete('subjects/:subjectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('subjects.delete')
  async deleteSubject(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    await this.academicService.deleteSubject(tenant.instituteId, subjectId);
  }

  @Post('subjects/:subjectId/restore')
  @RequiredPermission('subjects.update')
  async restoreSubject(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    const result = await this.academicService.restoreSubject(tenant.instituteId, subjectId);
    return result;
  }

  @Get('subjects/:subjectId/dependents')
  @RequiredPermission('subjects.read')
  async getDependents(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    const dependents = await this.academicService.subjectDependents(
      tenant.instituteId,
      subjectId,
    );
    return { dependents };
  }

  // ── Chapters ─────────────────────────────

  @Get('subjects/:subjectId/chapters')
  @RequiredPermission('chapters.read')
  async listChapters(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    const chapters = await this.academicService.listChapters(tenant.instituteId, subjectId);
    return { chapters };
  }

  @Post('subjects/:subjectId/chapters')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('chapters.create')
  async createChapter(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: CreateChapterDto,
  ) {
    const chapter = await this.academicService.createChapter(tenant.instituteId, subjectId, dto);
    return { chapter };
  }

  @Get('chapters/:chapterId')
  @RequiredPermission('chapters.read')
  async getChapter(
    @Tenant() tenant: TenantContext,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
  ) {
    const chapter = await this.academicService.getChapter(tenant.instituteId, chapterId);
    return { chapter };
  }

  @Patch('chapters/:chapterId')
  @RequiredPermission('chapters.update')
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
  @RequiredPermission('topics.read')
  async listTopics(
    @Tenant() tenant: TenantContext,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
  ) {
    const topics = await this.academicService.listTopics(tenant.instituteId, chapterId);
    return { topics };
  }

  @Post('chapters/:chapterId/topics')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('topics.create')
  async createTopic(
    @Tenant() tenant: TenantContext,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: CreateTopicDto,
  ) {
    const topic = await this.academicService.createTopic(tenant.instituteId, chapterId, dto);
    return { topic };
  }

  @Get('topics/:topicId')
  @RequiredPermission('topics.read')
  async getTopic(
    @Tenant() tenant: TenantContext,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    const topic = await this.academicService.getTopic(tenant.instituteId, topicId);
    return { topic };
  }

  @Patch('topics/:topicId')
  @RequiredPermission('topics.update')
  async updateTopic(
    @Tenant() tenant: TenantContext,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Body() dto: UpdateTopicDto,
  ) {
    const topic = await this.academicService.updateTopic(tenant.instituteId, topicId, dto);
    return { topic };
  }
}
