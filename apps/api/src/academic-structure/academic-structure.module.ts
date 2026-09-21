import { Module } from '@nestjs/common';
import { AcademicStructureController } from './academic-structure.controller.js';
import { AcademicStructureService } from './academic-structure.service.js';
import { TeacherAssignmentsController } from './teacher-assignments.controller.js';
import { TeacherAssignmentsService } from './teacher-assignments.service.js';
import { StudentPlacementsController } from './student-placements.controller.js';
import { StudentPlacementsService } from './student-placements.service.js';
import { StudentSubjectEnrollmentsController } from './student-enrollments.controller.js';
import { StudentSubjectEnrollmentsService } from './student-enrollments.service.js';

@Module({
  controllers: [
    AcademicStructureController,
    TeacherAssignmentsController,
    StudentPlacementsController,
    StudentSubjectEnrollmentsController,
  ],
  providers: [
    AcademicStructureService,
    TeacherAssignmentsService,
    StudentPlacementsService,
    StudentSubjectEnrollmentsService,
  ],
})
export class AcademicStructureModule {}