import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export class GenerateBankBucketDto {
  /* Open question-type code (predefined or custom) — existence checked in the service. */
  @IsString()
  @MaxLength(64)
  questionType!: string;

  @IsIn(['EASY', 'MEDIUM', 'HARD'])
  difficulty!: QuestionDifficulty;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  count!: number;
}

/** Exactly one of subjectId/chapterId/topicId — validated in the service. */
export class QuestionBankScopeDto {
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;
}

export class GenerateBankDto extends QuestionBankScopeDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  questionTypes?: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  count!: number;

  @IsOptional()
  difficultyDistribution?: {
    EASY: number;
    MEDIUM: number;
    HARD: number;
  };

  @IsOptional()
  @IsUUID()
  blueprintId?: string;
}

export class GenerateMoreDto extends QuestionBankScopeDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GenerateBankBucketDto)
  buckets!: GenerateBankBucketDto[];

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

/** Derive target buckets from an approved paper pattern's structure. */
export class GenerateBankFromBlueprintDto extends QuestionBankScopeDto {
  @IsUUID()
  blueprintId!: string;
}

/** Derive a type×difficulty distribution proposal from existing
 * bank questions + approved paper patterns, for a target bank size. */
export class DeriveDistributionDto extends QuestionBankScopeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  count!: number;
}
