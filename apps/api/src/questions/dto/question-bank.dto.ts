import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'FILL_IN_BLANK';
type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export class GenerateBankBucketDto {
  @IsIn(['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK'])
  questionType!: QuestionType;

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
  @ArrayMaxSize(3)
  @IsIn(['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK'], { each: true })
  questionTypes?: QuestionType[];

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
