import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export class GenerateQuestionsDto {
  @IsUUID()
  topicId!: string;

  /* Open question-type code (predefined or custom) — existence checked in the service. */
  @IsString()
  @MaxLength(64)
  questionType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  count!: number;

  @IsOptional()
  @IsIn(['EASY', 'MEDIUM', 'HARD'])
  difficulty?: QuestionDifficulty;

  @IsOptional()
  @IsUUID()
  blueprintId?: string;
}

export class BatchQuestionActionDto {
  @IsUUID(undefined, { each: true })
  questionIds!: string[];
}
