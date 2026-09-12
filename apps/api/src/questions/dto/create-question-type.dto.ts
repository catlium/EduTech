import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  MaxLength,
  Min,
  IsIn,
  IsObject,
  Max,
} from 'class-validator';

export class CreateQuestionTypeDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsIn(['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK', 'TEXT', 'MATCHING', 'NUMERICAL'])
  answerFormat!: string;

  @IsIn(['OBJECTIVE', 'SUBJECTIVE'])
  kind!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  defaultMarks?: number;

  @IsOptional()
  @IsArray()
  @IsIn(['EASY', 'MEDIUM', 'HARD'], { each: true })
  allowedDifficulties?: string[];

  @IsOptional()
  @IsObject()
  evaluationConfig?: Record<string, unknown>;
}