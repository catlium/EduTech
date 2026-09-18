import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ExtractQuestionsDto {
  @IsUUID()
  materialId!: string;

  @IsUUID()
  subjectId!: string;

  /* Optional scope acts as constraints/context, never a forced assignment. */
  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;
}

export class ReviewQuestionCandidateDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  stem?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  questionType?: string;

  @IsOptional()
  @IsIn(['EASY', 'MEDIUM', 'HARD'])
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  explanation?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  /* null = clear the assignment back to subject-only. */
  @IsOptional()
  @IsUUID()
  chapterId?: string | null;

  @IsOptional()
  @IsUUID()
  topicId?: string | null;
}