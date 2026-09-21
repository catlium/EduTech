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
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('syllabus')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class SyllabusController {
  constructor(private readonly syllabusService: SyllabusService) {}

  @Post('text')
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
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
  @RequiredRoles(...WRITE_ROLES)
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
  async get(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const syllabus = await this.syllabusService.getSyllabus(
      tenant.instituteId,
      tenant.membershipId,
      id,
    );
    return { syllabus };
  }

  @Get(':id/versions')
  async versions(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const versions = await this.syllabusService.getVersions(
      tenant.instituteId,
      tenant.membershipId,
      id,
    );
    return { versions };
  }

  @Patch(':id')
  @RequiredRoles(...WRITE_ROLES)
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
  @RequiredRoles(...WRITE_ROLES)
  async process(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.syllabusService.processSyllabus(tenant.instituteId, tenant.membershipId, id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async retry(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.syllabusService.retryProcessing(tenant.instituteId, tenant.membershipId, id);
  }

  @Post(':id/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
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
  @RequiredRoles(...WRITE_ROLES)
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
  @RequiredRoles(...WRITE_ROLES)
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
  @RequiredRoles(...WRITE_ROLES)
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
  @RequiredRoles(...WRITE_ROLES)
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
  @RequiredRoles(...WRITE_ROLES)
  async remove(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.syllabusService.deleteSyllabus(tenant.instituteId, tenant.membershipId, id);
  }
}
