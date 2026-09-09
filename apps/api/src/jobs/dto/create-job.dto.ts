import { IsString, MinLength, MaxLength, IsOptional, IsIn } from 'class-validator';
import { ALLOWED_JOB_TYPES } from '../jobs.service.js';

export class CreateJobDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @IsIn([...ALLOWED_JOB_TYPES])
  type!: string;

  @IsOptional()
  payload?: Record<string, unknown>;
}