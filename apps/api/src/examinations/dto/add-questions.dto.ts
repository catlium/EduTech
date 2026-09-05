import { ArrayMinSize, IsUUID } from 'class-validator';

export class AddQuestionsDto {
  @IsUUID(undefined, { each: true })
  @ArrayMinSize(1)
  questionIds!: string[];
}