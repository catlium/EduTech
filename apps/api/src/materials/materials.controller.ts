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
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { MaterialsService } from './materials.service.js';
import { UploadChunksService } from './upload-chunks.service.js';
import { OcrCoordinatorService } from '../ocr/ocr-coordinator.service.js';
import { CreateTextMaterialDto, UploadMaterialDto, UpdateMaterialDto } from './dto/material.dto.js';
import { MAX_FILE_SIZE, ALLOWED_FILE_TYPES } from './materials.constants.js';
import type { CreateOcrPageCorrectionRequest } from '@catlium/contracts';
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
 *  * F5.5 — material guard migration (§13 `materials`). Reads take `materials.read`
 * (TEACHER + STUDENT, so the four ungated reads stay open to every member);
 * creates take `materials.create`; the remaining mutations take
 * `materials.update`; and clearing an OCR page correction takes
 * `materials.delete`, because it removes that correction from the active
 * surface — the same §13 "remove one record" rule F5.4 applied to
 * `assessments.delete`. TEACHER holds all four and STUDENT only `read`, so the
 * legacy write gate is preserved exactly.
 *
 * `MaterialsService` / `OcrCoordinatorService` keep `requireWritableSubject`,
 * `requireReadableSubject` and `assertMaterialScoped`; nothing here replaces a
 * scope check.

 */
@Controller('materials')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class MaterialsController {
  constructor(
    private readonly materialsService: MaterialsService,
    private readonly ocrCoordinator: OcrCoordinatorService,
    private readonly chunks: UploadChunksService,
  ) {}

  @Post('text')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('materials.create')
  async createText(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTextMaterialDto,
  ) {
    const material = await this.materialsService.createTextMaterial(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto,
    );
    return { material };
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
  @RequiredPermission('materials.create')
  async upload(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadMaterialDto,
    @UploadedFile() file?: Express.Multer.File,
    @Headers('x-upload-id') uploadId?: string,
    @Headers('x-chunk-index') chunkIndex?: string,
    @Headers('x-chunk-total') chunkTotal?: string,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }

    const chunk = this.chunks.parse(uploadId, chunkIndex, chunkTotal);
    const result = await this.materialsService.createFromUpload(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      dto,
      file,
      chunk,
    );
    if (!('material' in result)) {
      return { chunk: { index: result.chunk.index, total: result.chunk.total } };
    }

    // Upload-first: the material (UPLOADED) is created before any processing is
    // triggered, then the pipeline auto-starts so the teacher just watches the
    // detail page progress. Best-effort so a queue hiccup still returns the 201.
    await this.materialsService
      .processMaterial(tenant.instituteId, tenant.membershipId, result.material.id)
      .catch(() => undefined);
    return { material: result.material };
  }

  @Get()
  @RequiredPermission('materials.read')
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
    const materials = await this.materialsService.listMaterials(tenant.instituteId, tenant.membershipId, {
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
  @RequiredPermission('materials.read')
  async ocrPages(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    return this.ocrCoordinator.listMaterialPages(tenant.instituteId, tenant.membershipId, materialId);
  }

  @Put(':materialId/ocr-pages/:page/correction')
  @RequiredPermission('materials.update')
  async saveCorrection(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @Param('page', ParseIntPipe) page: number,
    @Body() dto: CreateOcrPageCorrectionRequest,
  ) {
    return this.ocrCoordinator.saveCorrection(
      tenant.instituteId,
      tenant.membershipId,
      materialId,
      page,
      dto.text,
      user.userId,
    );
  }

  @Delete(':materialId/ocr-pages/:page/correction')
  @RequiredPermission('materials.delete')
  async clearCorrection(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @Param('page', ParseIntPipe) page: number,
  ) {
    return this.ocrCoordinator.clearCorrection(tenant.instituteId, tenant.membershipId, materialId, page);
  }

  @Get(':materialId')
  @RequiredPermission('materials.read')
  async get(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    const material = await this.materialsService.getMaterial(tenant.instituteId, tenant.membershipId, materialId);
    return { material };
  }

  @Patch(':materialId')
  @RequiredPermission('materials.update')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @Body() dto: UpdateMaterialDto,
  ) {
    const material = await this.materialsService.updateMaterial(
      tenant.instituteId,
      tenant.membershipId,
      user.userId,
      materialId,
      dto,
    );
    return { material };
  }

  @Post(':materialId/process')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('materials.update')
  async process(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    return this.materialsService.processMaterial(tenant.instituteId, tenant.membershipId, materialId);
  }

  @Post(':materialId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredPermission('materials.update')
  async retry(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    return this.materialsService.retryMaterial(tenant.instituteId, tenant.membershipId, materialId);
  }

  @Post(':materialId/archive')
  @RequiredPermission('materials.update')
  async archive(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    const material = await this.materialsService.setStatus(
      tenant.instituteId,
      tenant.membershipId,
      materialId,
      'ARCHIVED',
    );
    return { material };
  }

  @Post(':materialId/activate')
  @RequiredPermission('materials.update')
  async activate(
    @Tenant() tenant: TenantContext,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ) {
    const material = await this.materialsService.setStatus(
      tenant.instituteId,
      tenant.membershipId,
      materialId,
      'ACTIVE',
    );
    return { material };
  }
}
