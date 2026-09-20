import { Module } from '@nestjs/common';
import { AcademicStructureController } from './academic-structure.controller.js';
import { AcademicStructureService } from './academic-structure.service.js';
import { TeacherAssignmentsController } from './teacher-assignments.controller.js';
import { TeacherAssignmentsService } from './teacher-assignments.service.js';

@Module({
  controllers: [AcademicStructureController, TeacherAssignmentsController],
  providers: [AcademicStructureService, TeacherAssignmentsService],
})
export class AcademicStructureModule {}