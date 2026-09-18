import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateQuestionPaperDto {
  @IsUUID()
  @IsDefined()
  patternId!: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class RenameQuestionPaperDto {
  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(255)
  title!: string;
}

export class GenerateMissingQuestionPaperDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  buffer?: number;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}