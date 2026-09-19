import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { QuestionScopeDto } from '../common/dto/question-scope.dto.js';

export class CreatePaperPatternDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  // Many-to-many subject associations. Empty array = General pattern.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  subjectIds?: string[];

  // Legacy single-subject alias: mapped onto subjectIds by the service.
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsObject()
  structure?: Record<string, unknown>;
}

export class UpdatePaperPatternDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // Replaces the full association set; an empty array converts to General.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  subjectIds?: string[];

  @IsOptional()
  @IsObject()
  structure?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class AnalyzePaperPatternSourceDto {
  @IsIn(['TEXT', 'MATERIAL', 'PREVIOUS_YEAR_PAPER'])
  type!: 'TEXT' | 'MATERIAL' | 'PREVIOUS_YEAR_PAPER';

  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1_000_000)
  text?: string;
}

export class AnalyzePaperPatternDto {
  @ValidateNested()
  @Type(() => AnalyzePaperPatternSourceDto)
  source!: AnalyzePaperPatternSourceDto;
}

export class CreateAssessmentFromBlueprintDto extends QuestionScopeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ExtractTextDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1_000_000)
  text!: string;
}
