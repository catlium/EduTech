import { IsString, IsOptional, IsUUID } from 'class-validator';

export class AIGenerateNoteDto {
  @IsUUID()
  materialId!: string;

  @IsOptional()
  @IsString()
  title?: string;
}
