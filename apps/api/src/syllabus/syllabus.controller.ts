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
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { SyllabusService } from './syllabus.service.js';
import { CreateTextSyllabusDto, UpdateSyllabusDto, UploadSyllabusDto } from './dto/syllabus.dto.js';
import { MAX_FILE_SIZE, ALLOWED_FILE_TYPES } from '../materials/materials.constants.js';
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
 *  * F5.5 — syllabus guard migration (§13 `syllabus`). The three ungated reads
 * take `syllabus.read` (TEACHER + STUDENT, so they stay open to every member);
 * the two creates take `syllabus.create`; the eight lifecycle mutations — update,
 * process, retry, analyze, confirm, lock, unlock, archive — take
 * `syllabus.update`; and the one hard delete takes `syllabus.delete`. TEACHER
 * holds all four and STUDENT only `read`, so the legacy write gate is preserved
 * exactly.
 *
 * `SyllabusService` keeps `requireWritableSubject` on all fourteen routes plus
 * its `assertUnlocked`/status guards; this layer only answers "may this role
 * perform the action".

 */
@Controller('syllabus')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class SyllabusController {
  constructor(private readonly syllabusService: SyllabusService) {}

  @Post('text')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('syllabus.create')
  async createText(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTextSyllabusDto,
  ) {
    const syllabus = await this.syllabusService.createTextSyllabus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto,
    );
    return { syllabus };
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_FILE_TYPES.has(file.mimetype)) {
          cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @RequiredPermission('syllabus.create')
  async upload(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadSyllabusDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }

    const syllabus = await this.syllabusService.createFileSyllabus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto,
      file,
    );
    return { syllabus };
  }

  @Get()
  @RequiredPermission('syllabus.read')
  async list(
    @Tenant() tenant: TenantContext,
    @Query('subjectId', new ParseUUIDPipe({ optional: true })) subjectId?: string,
  ) {
    const syllabi = await this.syllabusService.listSyllabi(
      tenant.instituteId,
      tenant.membershipId,
      subjectId,
    );
    return { syllabi };
  }

  @Get(':id')
  @RequiredPermission('syllabus.read')
  async get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const syllabus = await this.syllabusService.getSyllabus(
      tenant.instituteId,
      tenant.membershipId,
      id,
    );
    return { syllabus };
  }

  @Get(':id/versions')
  @RequiredPermission('syllabus.read')
  async versions(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const versions = await this.syllabusService.getVersions(
      tenant.instituteId,
      tenant.membershipId,
      id,
    );
    return { versions };
  }

  @Patch(':id')
  @RequiredPermission('syllabus.update')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSyllabusDto,
  ) {
    const syllabus = await this.syllabusService.updateSyllabus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      id,
      dto,
    );
    return { syllabus };
  }

  @Post(':id/process')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('syllabus.update')
  async process(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.syllabusService.processSyllabus(tenant.instituteId, tenant.membershipId, id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('syllabus.update')
  async retry(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.syllabusService.retryProcessing(tenant.instituteId, tenant.membershipId, id);
  }

  @Post(':id/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('syllabus.update')
  async analyze(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.syllabusService.analyzeSyllabus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      id,
    );
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('syllabus.update')
  async confirm(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.syllabusService.confirmSyllabus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      id,
    );
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('syllabus.update')
  async unlock(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const syllabus = await this.syllabusService.setLocked(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      id,
      false,
    );
    return { syllabus };
  }

  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission('syllabus.update')
  async lock(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const syllabus = await this.syllabusService.setLocked(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      id,
      true,
    );
    return { syllabus };
  }

  @Post(':id/archive')
  @RequiredPermission('syllabus.update')
  async archive(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const syllabus = await this.syllabusService.archiveSyllabus(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      id,
    );
    return { syllabus };
  }

  @Delete(':id')
  @RequiredPermission('syllabus.delete')
  async remove(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.syllabusService.deleteSyllabus(tenant.instituteId, tenant.membershipId, id);
  }
}
