import { Type } from 'class-transformer';
import {
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

export class CreatePaperPatternDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsUUID()
  subjectId!: string;

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

export class CreateAssessmentFromBlueprintDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}