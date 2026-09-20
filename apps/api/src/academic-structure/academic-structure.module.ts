import { Module } from '@nestjs/common';
import { AcademicStructureController } from './academic-structure.controller.js';
import { AcademicStructureService } from './academic-structure.service.js';
import { TeacherAssignmentsController } from './teacher-assignments.controller.js';
import { TeacherAssignmentsService } from './teacher-assignments.service.js';
import { StudentPlacementsController } from './student-placements.controller.js';
import { StudentPlacementsService } from './student-placements.service.js';

@Module({
  controllers: [
    AcademicStructureController,
    TeacherAssignmentsController,
    StudentPlacementsController,
  ],
  providers: [AcademicStructureService, TeacherAssignmentsService, StudentPlacementsService],
})
export class AcademicStructureModule {}