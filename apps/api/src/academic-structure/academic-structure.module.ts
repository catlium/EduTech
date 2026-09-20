import { Module } from '@nestjs/common';
import { AcademicStructureController } from './academic-structure.controller.js';
import { AcademicStructureService } from './academic-structure.service.js';

@Module({
  controllers: [AcademicStructureController],
  providers: [AcademicStructureService],
})
export class AcademicStructureModule {}