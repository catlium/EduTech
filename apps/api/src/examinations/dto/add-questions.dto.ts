import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsUUID } from 'class-validator';

export class AddQuestionsDto {
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  @ArrayMinSize(1)
  questionIds!: string[];
}