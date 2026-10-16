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
  UseGuards,
} from '@nestjs/common';

import { AcademicStructureService } from './academic-structure.service.js';
import {
  CreateAcademicYearDto,
  CreateClassDto,
  CreateDivisionDto,
  UpdateAcademicYearDto,
  UpdateClassDto,
  UpdateDivisionDto,
} from './dto/academic-structure.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

// Academic structure layer (Phase E, revised D4/§16): academic years, classes,
// class-subject offerings and divisions. F5.2: authorization is the permission
// catalogue's single `academic-structure` resource (D4), not roles —
// INSTITUTE_ADMIN holds `academic-structure.manage` through the built-in mapping
// (implying every action), and a custom institute role may be granted any
// sub-action through `PUT /roles/:roleId/permissions`. TEACHER/STUDENT hold no
// `academic-structure.*` key, so structural config is admin-only by default.
// The service keeps the institute scoping on every query; the permission check
// authorizes the operation, it never substitutes for it.

@Controller('academic')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class AcademicStructureController {
  constructor(private readonly academicStructureService: AcademicStructureService) {}

  // ── Academic years ──────────────────────────

  @Get('academic-years')
  @RequiredPermission('academic-structure.read')
  async listAcademicYears(@Tenant() tenant: TenantContext) {
    const academicYears = await this.academicStructureService.listAcademicYears(
      tenant.instituteId,
    );
    return { academicYears };
  }

  @Post('academic-years')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('academic-structure.create')
  async createAcademicYear(@Tenant() tenant: TenantContext, @Body() dto: CreateAcademicYearDto) {
    const academicYear = await this.academicStructureService.createAcademicYear(
      tenant.instituteId,
      dto,
    );
    return { academicYear };
  }

  @Patch('academic-years/:academicYearId')
  @RequiredPermission('academic-structure.update')
  async updateAcademicYear(
    @Tenant() tenant: TenantContext,
    @Param('academicYearId', ParseUUIDPipe) academicYearId: string,
    @Body() dto: UpdateAcademicYearDto,
  ) {
    const academicYear = await this.academicStructureService.updateAcademicYear(
      tenant.instituteId,
      academicYearId,
      dto,
    );
    return { academicYear };
  }

  // ── Classes ─────────────────────────────────

  @Get('classes')
  @RequiredPermission('academic-structure.read')
  async listClasses(@Tenant() tenant: TenantContext) {
    const classes = await this.academicStructureService.listClasses(tenant.instituteId);
    return { classes };
  }

  @Post('classes')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('academic-structure.create')
  async createClass(@Tenant() tenant: TenantContext, @Body() dto: CreateClassDto) {
    const klass = await this.academicStructureService.createClass(tenant.instituteId, dto);
    return { class: klass };
  }

  @Patch('classes/:classId')
  @RequiredPermission('academic-structure.update')
  async updateClass(
    @Tenant() tenant: TenantContext,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: UpdateClassDto,
  ) {
    const klass = await this.academicStructureService.updateClass(tenant.instituteId, classId, dto);
    return { class: klass };
  }

  @Delete('classes/:classId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('academic-structure.delete')
  async deleteClass(
    @Tenant() tenant: TenantContext,
    @Param('classId', ParseUUIDPipe) classId: string,
  ) {
    await this.academicStructureService.deleteClass(tenant.instituteId, classId);
  }

  // ── Class-subject offerings ─────────────────

  @Get('classes/:classId/subjects')
  @RequiredPermission('academic-structure.read')
  async listClassSubjects(
    @Tenant() tenant: TenantContext,
    @Param('classId', ParseUUIDPipe) classId: string,
  ) {
    const subjects = await this.academicStructureService.listClassSubjects(
      tenant.instituteId,
      classId,
    );
    return { subjects };
  }

  @Post('classes/:classId/subjects/:subjectId')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('academic-structure.create')
  async addClassSubject(
    @Tenant() tenant: TenantContext,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    const result = await this.academicStructureService.addClassSubject(
      tenant.instituteId,
      classId,
      subjectId,
    );
    return result;
  }

  @Delete('classes/:classId/subjects/:subjectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('academic-structure.delete')
  async removeClassSubject(
    @Tenant() tenant: TenantContext,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    await this.academicStructureService.removeClassSubject(tenant.instituteId, classId, subjectId);
  }

  // ── Divisions ───────────────────────────────

  @Get('divisions')
  @RequiredPermission('academic-structure.read')
  async listDivisions(
    @Tenant() tenant: TenantContext,
    @Query('academicYearId', new ParseUUIDPipe({ optional: true })) academicYearId?: string,
    @Query('classId', new ParseUUIDPipe({ optional: true })) classId?: string,
  ) {
    const divisions = await this.academicStructureService.listDivisions(tenant.instituteId, {
      academicYearId,
      classId,
    });
    return { divisions };
  }

  @Post('divisions')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('academic-structure.create')
  async createDivision(@Tenant() tenant: TenantContext, @Body() dto: CreateDivisionDto) {
    const division = await this.academicStructureService.createDivision(tenant.instituteId, dto);
    return { division };
  }

  @Patch('divisions/:divisionId')
  @RequiredPermission('academic-structure.update')
  async updateDivision(
    @Tenant() tenant: TenantContext,
    @Param('divisionId', ParseUUIDPipe) divisionId: string,
    @Body() dto: UpdateDivisionDto,
  ) {
    const division = await this.academicStructureService.updateDivision(
      tenant.instituteId,
      divisionId,
      dto,
    );
    return { division };
  }

  @Delete('divisions/:divisionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('academic-structure.delete')
  async deleteDivision(
    @Tenant() tenant: TenantContext,
    @Param('divisionId', ParseUUIDPipe) divisionId: string,
  ) {
    await this.academicStructureService.deleteDivision(tenant.instituteId, divisionId);
  }
}