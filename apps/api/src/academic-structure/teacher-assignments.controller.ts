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

import { TeacherAssignmentsService } from './teacher-assignments.service.js';
import { CreateTeacherAssignmentDto } from './dto/teacher-assignments.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';

// Teacher assignments (Phase F, Q.3.0): management of which TEACHER memberships
// teach which class-subject offering. Authorization is permission-based on the
// `assignments` resource (Q.3.0 design) — INSTITUTE_ADMIN holds assignments.
// manage through the built-in mapping; custom institute roles may be granted
// assignments.read/create/delete for delegated staffing. Teachers cannot assign
// themselves or others — reads included, so staffing config never leaks to
// students — and the service additionally requires the target membership to
// actually hold TEACHER.

@Controller('academic/teacher-assignments')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class TeacherAssignmentsController {
  constructor(private readonly teacherAssignmentsService: TeacherAssignmentsService) {}

  @Get()
  @RequiredPermission('assignments.read')
  async listTeacherAssignments(
    @Tenant() tenant: TenantContext,
    @Query('classSubjectId', new ParseUUIDPipe({ optional: true })) classSubjectId?: string,
    @Query('membershipId', new ParseUUIDPipe({ optional: true })) membershipId?: string,
  ) {
    const assignments = await this.teacherAssignmentsService.listTeacherAssignments(tenant.instituteId, {
      classSubjectId,
      membershipId,
    });
    return { assignments };
  }

  @Get(':assignmentId')
  @RequiredPermission('assignments.read')
  async getTeacherAssignment(
    @Tenant() tenant: TenantContext,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    const assignment = await this.teacherAssignmentsService.getTeacherAssignment(
      tenant.instituteId,
      assignmentId,
    );
    return { assignment };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('assignments.create')
  async createTeacherAssignment(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateTeacherAssignmentDto,
  ) {
    const assignment = await this.teacherAssignmentsService.createTeacherAssignment(
      tenant.instituteId,
      dto,
    );
    return { assignment };
  }

  @Delete(':assignmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('assignments.delete')
  async deactivateTeacherAssignment(
    @Tenant() tenant: TenantContext,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    await this.teacherAssignmentsService.deactivateTeacherAssignment(
      tenant.instituteId,
      assignmentId,
    );
  }
}