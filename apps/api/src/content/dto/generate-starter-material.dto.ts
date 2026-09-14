import { IsUUID } from 'class-validator';

export class GenerateStarterMaterialDto {
  @IsUUID()
  topicId!: string;
}
