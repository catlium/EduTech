import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  ParseEnumPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { MaterialsService } from './materials.service.js';
import { OcrCoordinatorService } from '../ocr/ocr-coordinator.service.js';
import { CreateTextMaterialDto, UploadMaterialDto, UpdateMaterialDto } from './dto/material.dto.js';
import { MAX_FILE_SIZE, ALLOWED_FILE_TYPES } from './materials.constants.js';
import type { CreateOcrPageCorrectionRequest } from '@catlium/contracts';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('materials')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class MaterialsController {
  constructor(
    private readonly materialsService: MaterialsService,
    private readonly ocrCoordinator: OcrCoordinatorService,
  ) {}

  @Post('text')
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async createText(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTextMaterialDto,
  ) {
    const material = await this.materialsService.createTextMaterial(
      tenant.instituteId,
      user.userId,
      dto,
    );
    return { material };
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
    @Body() dto: UploadMaterialDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }

    const material = await this.materialsService.createFileMaterial(
      tenant.instituteId,
      user.userId,
      dto,
      file,
    );
    return { material };
  }

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @Query(
      'materialType',
      new ParseEnumPipe(['DOCUMENT', 'PDF', 'IMAGE', 'TEXT'], { optional: true }),
    )
    materialType?: string,
    @Query('sourceType', new ParseEnumPipe(['UPLOAD', 'TEXT', 'IMPORTED'], { optional: true }))
    sourceType?: string,
    @Query(
      'processingStatus',
      new ParseEnumPipe(['UPLOADED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'], {
        optional: true,
      }),
    )
    processingStatus?: string,
    @Query('status', new ParseEnumPipe(['ACTIVE', 'ARCHIVED'], { optional: true }))
    status?: 'ACTIVE' | 'ARCHIVED',
    @Query('q') q?: string,
    @Query('subjectId', new ParseUUIDPipe({ optional: true })) subjectId?: string,
    @Query('chapterId', new ParseUUIDPipe({ optional: true })) chapterId?: string,
    @Query('topicId', new ParseUUIDPipe({ optional: true })) topicId?: string,
  ) {
    const materials = await this.materialsService.listMaterials(tenant.instituteId, {
      materialType,
      sourceType,
      processingStatus,
      status,
      q,
      subjectId,
      chapterId,
      topicId,
    });
    return { materials };
  }

  @Get(':materialId/ocr-pages')
  async ocrPages(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    return this.ocrCoordinator.listMaterialPages(tenant.instituteId, materialId);
  }

  @Put(':materialId/ocr-pages/:page/correction')
  @RequiredRoles(...WRITE_ROLES)
  async saveCorrection(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @Param('page', ParseIntPipe) page: number,
    @Body() dto: CreateOcrPageCorrectionRequest,
  ) {
    return this.ocrCoordinator.saveCorrection(
      tenant.instituteId,
      materialId,
      page,
      dto.text,
      user.userId,
    );
  }

  @Delete(':materialId/ocr-pages/:page/correction')
  @RequiredRoles(...WRITE_ROLES)
  async clearCorrection(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @Param('page', ParseIntPipe) page: number,
  ) {
    return this.ocrCoordinator.clearCorrection(tenant.instituteId, materialId, page);
  }

  @Get(':materialId')
  async get(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    const material = await this.materialsService.getMaterial(tenant.instituteId, materialId);
    return { material };
  }

  @Patch(':materialId')
  @RequiredRoles(...WRITE_ROLES)
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @Body() dto: UpdateMaterialDto,
  ) {
    const material = await this.materialsService.updateMaterial(
      tenant.instituteId,
      user.userId,
      materialId,
      dto,
    );
    return { material };
  }

  @Post(':materialId/process')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async process(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    return this.materialsService.processMaterial(tenant.instituteId, materialId);
  }

  @Post(':materialId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async retry(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    return this.materialsService.retryMaterial(tenant.instituteId, materialId);
  }

  @Post(':materialId/archive')
  @RequiredRoles(...WRITE_ROLES)
  async archive(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    const material = await this.materialsService.setStatus(
      tenant.instituteId,
      materialId,
      'ARCHIVED',
    );
    return { material };
  }

  @Post(':materialId/activate')
  @RequiredRoles(...WRITE_ROLES)
  async activate(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    const material = await this.materialsService.setStatus(
      tenant.instituteId,
      materialId,
      'ACTIVE',
    );
    return { material };
  }
}
