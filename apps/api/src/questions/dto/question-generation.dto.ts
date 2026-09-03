import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'FILL_IN_BLANK';
type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export class GenerateQuestionsDto {
  @IsUUID()
  topicId!: string;

  @IsIn(['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK'])
  questionType!: QuestionType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  count!: number;

  @IsOptional()
  @IsIn(['EASY', 'MEDIUM', 'HARD'])
  difficulty?: QuestionDifficulty;
}

export class BatchQuestionActionDto {
  @IsUUID(undefined, { each: true })
  questionIds!: string[];
}
