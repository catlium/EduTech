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

import { StudentSubjectEnrollmentsService } from './student-enrollments.service.js';
import { CreateStudentEnrollmentDto } from './dto/student-enrollments.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import { PermissionGuard } from '../authorization/permissions.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';

// Phase H, E.1 — student subject enrollment overrides (D5/§17). Authorization
// is permission-based on the `assignments` resource (the Q.4 sibling slice of
// student placements, D-Q4.10) — INSTITUTE_ADMIN holds assignments.manage
// through the built-in mapping; custom institute roles may be granted
// assignments.read/create/delete for delegated override authority. Students
// cannot override their own scope and teachers cannot edit another student's
// set — every route (reads included, so a student's overrides never leak)
// requires a grant, and the service additionally pins the placement/subject
// to the institute and validates the override against the placement class's
// offerings.

@Controller('academic/student-enrollments')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)
export class StudentSubjectEnrollmentsController {
  constructor(
    private readonly studentSubjectEnrollmentsService: StudentSubjectEnrollmentsService,
  ) {}

  @Get()
  @RequiredPermission('assignments.read')
  async list(
    @Tenant() tenant: TenantContext,
    @Query('placementId', new ParseUUIDPipe({ optional: true })) placementId?: string,
    @Query('subjectId', new ParseUUIDPipe({ optional: true })) subjectId?: string,
  ) {
    const enrollments = await this.studentSubjectEnrollmentsService.listStudentEnrollments(
      tenant.instituteId,
      { placementId, subjectId },
    );
    return { enrollments };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('assignments.create')
  async create(@Tenant() tenant: TenantContext, @Body() dto: CreateStudentEnrollmentDto) {
    const enrollment = await this.studentSubjectEnrollmentsService.createStudentEnrollment(
      tenant.instituteId,
      dto,
    );
    return { enrollment };
  }

  @Delete(':enrollmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredPermission('assignments.delete')
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
  ) {
    await this.studentSubjectEnrollmentsService.removeStudentEnrollment(
      tenant.instituteId,
      enrollmentId,
    );
  }
}