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
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

// Student placements (Phase G): INSTITUTE_ADMIN-only management of which
// STUDENT memberships are placed into which division of an academic year.
// Students cannot assign themselves; teachers cannot modify placements — every
// route (reads included, so placement data never leaks to students) requires
// the admin role, and the service additionally requires the target membership
// to actually hold STUDENT and be active.
const PLACEMENT_ADMIN = ['INSTITUTE_ADMIN'] as const;

@Controller('academic/student-placements')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class StudentPlacementsController {
  constructor(private readonly studentPlacementsService: StudentPlacementsService) {}

  @Get()
  @RequiredRoles(...PLACEMENT_ADMIN)
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
  @RequiredRoles(...PLACEMENT_ADMIN)
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
  @RequiredRoles(...PLACEMENT_ADMIN)
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
  @RequiredRoles(...PLACEMENT_ADMIN)
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
  @RequiredRoles(...PLACEMENT_ADMIN)
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