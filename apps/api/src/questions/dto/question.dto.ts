import {
  IsString,
  IsOptional,
  IsObject,
  IsIn,
  MaxLength,
  IsUUID,
} from 'class-validator';

type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
type QuestionSource = 'MANUAL' | 'AI_GENERATED';

export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  stem?: string;

  @IsOptional()
  @IsIn(['EASY', 'MEDIUM', 'HARD'])
  difficulty?: QuestionDifficulty;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  explanation?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class CreateQuestionDto {
  @IsString()
  @MaxLength(20000)
  stem!: string;

  /* Open question-type code (predefined or custom) — existence checked in the service. */
  @IsString()
  @MaxLength(64)
  questionType!: string;

  @IsOptional()
  @IsIn(['EASY', 'MEDIUM', 'HARD'])
  difficulty?: QuestionDifficulty;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  explanation?: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsIn(['MANUAL', 'AI_GENERATED'])
  source!: QuestionSource;

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