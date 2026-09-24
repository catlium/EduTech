import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { StudentPlacementsService } from './student-placements.service.js';
import { CreateStudentPlacementDto, TransferStudentPlacementDto } from './dto/student-placements.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission, RequiredPermissions } from '../authorization/permissions.decorator.js';

// Student placements (Phase G, Q.4.1): management of which STUDENT memberships
// are placed into which division of an academic year. Authorization is
// permission-based on the `assignments` resource (Q.4.0 design) — INSTITUTE_
// ADMIN holds assignments.manage through the built-in mapping; custom
// institute roles may be granted assignments.read/create/delete for delegated
// placement authority. Students cannot assign themselves; teachers cannot
// modify placements — every route (reads included, so placement data never
// leaks to students) requires a grant, and the service additionally requires
// the target membership to actually hold STUDENT and be active. Transfer
// archives the current placement AND creates a fresh one in a single call, so
// it requires BOTH assignments.create AND assignments.delete (AND rule).

@Controller('academic/student-placements')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class StudentPlacementsController {
  constructor(private readonly studentPlacementsService: StudentPlacementsService) {}

  @Get()
  @RequiredPermission('assignments.read')
  async listStudentPlacements(
    @Tenant() tenant: TenantContext,
    @Query('academicYearId', new ParseUUIDPipe({ optional: true })) academicYearId?: string,
    @Query('divisionId', new ParseUUIDPipe({ optional: true })) divisionId?: string,
    @Query('membershipId', new ParseUUIDPipe({ optional: true })) membershipId?: string,
  ) {
    const placements = await this.studentPlacementsService.listStudentPlacements(tenant.instituteId, {
      academicYearId,
      divisionId,
      membershipId,
    });
    return { placements };
  }

  @Get(':placementId')
  @RequiredPermission('assignments.read')
  async getStudentPlacement(
    @Tenant() tenant: TenantContext,
    @Param('placementId', ParseUUIDPipe) placementId: string,
  ) {
    const placement = await this.studentPlacementsService.getStudentPlacement(
      tenant.instituteId,
      placementId,
    );
    return { placement };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('assignments.create')
  async createStudentPlacement(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateStudentPlacementDto,
  ) {
    const placement = await this.studentPlacementsService.createStudentPlacement(
      tenant.instituteId,
      dto,
    );
    return { placement };
  }

  @Post(':placementId/transfer')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermissions('assignments.create', 'assignments.delete')
  async transferStudentPlacement(
    @Tenant() tenant: TenantContext,
    @Param('placementId', ParseUUIDPipe) placementId: string,
    @Body() dto: TransferStudentPlacementDto,
  ) {
    const placement = await this.studentPlacementsService.transferStudentPlacement(
      tenant.instituteId,
      placementId,
      dto,
    );
    return { placement };
  }

  @Delete(':placementId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('assignments.delete')
  async deactivateStudentPlacement(
    @Tenant() tenant: TenantContext,
    @Param('placementId', ParseUUIDPipe) placementId: string,
  ) {
    await this.studentPlacementsService.deactivateStudentPlacement(
      tenant.instituteId,
      placementId,
    );
  }
}