import { BadRequestException } from '@nestjs/common';
import {
  SyllabusContextSchema,
  SyllabusStructureSchema,
  type SyllabusContext,
  type SyllabusStructure,
} from '@catlium/contracts';

export const SyllabusValidator = {
  parseStructure(structure: unknown): SyllabusStructure {
    try {
      return SyllabusStructureSchema.parse(structure);
    } catch {
      throw new BadRequestException('Invalid syllabus structure');
    }
  },

  parseContext(context: unknown): SyllabusContext {
    try {
      return SyllabusContextSchema.parse(context);
    } catch {
      throw new BadRequestException('Invalid syllabus context');
    }
  },
};