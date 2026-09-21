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
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';

// Phase H — student subject enrollment overrides (D5/§17): INSTITUTE_ADMIN
// only. Students cannot override their own scope and teachers cannot edit
// another student's set — every route (reads included, so a student's
// overrides never leak) requires INSTITUTE_ADMIN; the service additionally
// pins the placement/subject to the institute and validates the override
// against the placement class's offerings.
const ENROLLMENT_ADMIN = ['INSTITUTE_ADMIN'] as const;

@Controller('academic/student-enrollments')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class StudentSubjectEnrollmentsController {
  constructor(
    private readonly studentSubjectEnrollmentsService: StudentSubjectEnrollmentsService,
  ) {}

  @Get()
  @RequiredRoles(...ENROLLMENT_ADMIN)
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
  @RequiredRoles(...ENROLLMENT_ADMIN)
  async create(@Tenant() tenant: TenantContext, @Body() dto: CreateStudentEnrollmentDto) {
    const enrollment = await this.studentSubjectEnrollmentsService.createStudentEnrollment(
      tenant.instituteId,
      dto,
    );
    return { enrollment };
  }

  @Delete(':enrollmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredRoles(...ENROLLMENT_ADMIN)
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