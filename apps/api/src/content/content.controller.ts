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
import { ContentGenerationService } from './content-generation.service.js';
import { CreateContentDto, UpdateContentDto } from './dto/content.dto.js';
import { AIGenerateNoteDto } from './dto/ai-generate-note.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('content')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly contentGenerationService: ContentGenerationService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async generateNote(
    @Tenant() tenant: TenantContext,
    @Body() dto: AIGenerateNoteDto,
  ) {
    return await this.contentGenerationService.generateNote(
      tenant.instituteId,
      dto,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateContentDto,
  ) {
    const { item, current } = await this.contentService.createContent(
      tenant.instituteId,
      user.userId,
      dto,
    );
    return { content: { ...item, current } };
  }

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @Query('type', new ParseEnumPipe(['NOTE', 'FLASHCARD_SET', 'CORNELL_NOTE'], { optional: true }))
    type?: 'NOTE' | 'FLASHCARD_SET' | 'CORNELL_NOTE',
    @Query('status', new ParseEnumPipe(['DRAFT', 'ACTIVE', 'ARCHIVED'], { optional: true }))
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
    @Query('subjectId', new ParseUUIDPipe({ optional: true })) subjectId?: string,
    @Query('chapterId', new ParseUUIDPipe({ optional: true })) chapterId?: string,
    @Query('topicId', new ParseUUIDPipe({ optional: true })) topicId?: string,
  ) {
    const contents = await this.contentService.listContent(tenant.instituteId, {
      type,
      status,
      subjectId,
      chapterId,
      topicId,
    });
    return { contents };
  }

  @Get(':contentId')
  async get(@Tenant() tenant: TenantContext, @Param('contentId', ParseUUIDPipe) contentId: string) {
    const { item, current } = await this.contentService.getContent(tenant.instituteId, contentId);
    return { content: { ...item, current } };
  }

  @Patch(':contentId')
  @RequiredRoles(...WRITE_ROLES)
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() dto: UpdateContentDto,
  ) {
    const { item, current } = await this.contentService.updateContent(
      tenant.instituteId,
      user.userId,
      contentId,
      dto,
    );
    return { content: { ...item, current } };
  }

  @Get(':contentId/versions')
  async listVersions(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const versions = await this.contentService.listVersions(tenant.instituteId, contentId);
    return { versions };
  }

  @Get(':contentId/versions/:version')
  async getVersion(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const v = await this.contentService.getVersion(tenant.instituteId, contentId, version);
    return { version: v };
  }

  @Post(':contentId/archive')
  @RequiredRoles(...WRITE_ROLES)
  async archive(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const content = await this.contentService.setStatus(tenant.instituteId, contentId, 'ARCHIVED');
    return { content };
  }

  @Post(':contentId/activate')
  @RequiredRoles(...WRITE_ROLES)
  async activate(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const content = await this.contentService.setStatus(tenant.instituteId, contentId, 'ACTIVE');
    return { content };
  }
}
