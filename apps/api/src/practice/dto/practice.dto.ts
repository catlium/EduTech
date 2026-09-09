import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';

export class PracticeCreateDto {
  @IsIn(['FLASHCARD', 'QUESTION'])
  mode!: 'FLASHCARD' | 'QUESTION';

  @IsOptional()
  @IsUUID()
  contentId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;
}

export class PracticeSaveAnswerDto {
  @IsOptional()
  @IsObject()
  answer?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['AGAIN', 'GOOD'])
  rating?: 'AGAIN' | 'GOOD';
}