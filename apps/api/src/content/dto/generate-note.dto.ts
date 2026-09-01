import { IsIn, IsUUID } from 'class-validator';

export class GenerateNoteDto {
  @IsIn(['MATERIAL', 'TOPIC'])
  sourceType!: 'MATERIAL' | 'TOPIC';

  @IsUUID()
  sourceId!: string;
}
