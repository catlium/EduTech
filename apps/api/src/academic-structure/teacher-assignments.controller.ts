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
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

// Teacher assignments (Phase F): INSTITUTE_ADMIN-only management of which
// TEACHER memberships teach which class-subject offering. Teachers cannot
// assign themselves or others — every route (reads included, so staffing
// config never leaks to students) requires the admin role, and the service
// additionally requires the target membership to actually hold TEACHER.
const ASSIGNMENT_ADMIN = ['INSTITUTE_ADMIN'] as const;

@Controller('academic/teacher-assignments')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class TeacherAssignmentsController {
  constructor(private readonly teacherAssignmentsService: TeacherAssignmentsService) {}

  @Get()
  @RequiredRoles(...ASSIGNMENT_ADMIN)
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
  @RequiredRoles(...ASSIGNMENT_ADMIN)
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
  @RequiredRoles(...ASSIGNMENT_ADMIN)
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
  @RequiredRoles(...ASSIGNMENT_ADMIN)
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