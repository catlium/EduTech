import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ParseEnumPipe,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { ContentService } from './content.service.js';
import { CreateContentDto, UpdateContentDto } from './dto/content.dto.js';
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
 *  * F5.5 — content item / version guard migration (§13 `content`). One key per
 * operation: the five reads that carried no role gate take `content.read` (held
 * by TEACHER and STUDENT, so they stay reachable by every member exactly as
 * before), the three mutations take `content.update`, and the insert takes
 * `content.create` — all of which TEACHER holds and STUDENT does not, so the
 * legacy `INSTITUTE_ADMIN`/`TEACHER` write gate is preserved without widening.
 *
 * `ContentService` keeps every gate it already owned: the DRAFT-creator rule
 * (`gateContent` — 403 on a foreign DRAFT, 404 on an out-of-scope read) and the
 * institute filter. This layer only answers "may this role perform the action".

 */
@Controller('content')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('content.create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateContentDto,
  ) {
    const { item, current } = await this.contentService.createContent(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto,
    );
    return { content: { ...item, current } };
  }

  @Get()
  @RequiredPermission('content.read')
  async list(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query(
      'type',
      new ParseEnumPipe(
        ['NOTE', 'FLASHCARD_SET', 'CORNELL_NOTE', 'SUMMARY', 'IMPORTANT_CONCEPTS'],
        { optional: true },
      ),
    )
    type?: 'NOTE' | 'FLASHCARD_SET' | 'CORNELL_NOTE' | 'SUMMARY' | 'IMPORTANT_CONCEPTS',
    @Query('status', new ParseEnumPipe(['DRAFT', 'ACTIVE', 'ARCHIVED'], { optional: true }))
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
    @Query('q') q?: string,
    @Query('subjectId', new ParseUUIDPipe({ optional: true })) subjectId?: string,
    @Query('chapterId', new ParseUUIDPipe({ optional: true })) chapterId?: string,
    @Query('topicId', new ParseUUIDPipe({ optional: true })) topicId?: string,
  ) {
    const contents = await this.contentService.listContent(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      {
        type,
        status,
        q,
        subjectId,
        chapterId,
        topicId,
      },
    );
    return { contents };
  }

  @Get(':contentId')
  @RequiredPermission('content.read')
  async get(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const { item, current } = await this.contentService.getContent(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      contentId,
    );
    return { content: { ...item, current } };
  }

  @Patch(':contentId')
  @RequiredPermission('content.update')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() dto: UpdateContentDto,
  ) {
    const { item, current } = await this.contentService.updateContent(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      contentId,
      dto,
    );
    return { content: { ...item, current } };
  }

  @Get(':contentId/versions')
  @RequiredPermission('content.read')
  async listVersions(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const versions = await this.contentService.listVersions(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      contentId,
    );
    return { versions };
  }

  @Get(':contentId/versions/:version')
  @RequiredPermission('content.read')
  async getVersion(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const v = await this.contentService.getVersion(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      contentId,
      version,
    );
    return { version: v };
  }

  @Post(':contentId/archive')
  @RequiredPermission('content.update')
  async archive(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const content = await this.contentService.setStatus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      contentId,
      'ARCHIVED',
    );
    return { content };
  }

  @Post(':contentId/activate')
  @RequiredPermission('content.update')
  async activate(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const content = await this.contentService.setStatus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      contentId,
      'ACTIVE',
    );
    return { content };
  }
}
