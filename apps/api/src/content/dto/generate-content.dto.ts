import { IsIn, IsUUID } from 'class-validator';

export const GENERATION_OPERATIONS = [
  'AI_GENERATE_NOTE',
  'AI_GENERATE_SUMMARY',
  'AI_GENERATE_FLASHCARDS',
  'AI_GENERATE_CONCEPTS',
] as const;

export class GenerateContentDto {
  @IsIn(GENERATION_OPERATIONS)
  operation!: (typeof GENERATION_OPERATIONS)[number];

  @IsIn(['MATERIAL', 'TOPIC'])
  sourceType!: 'MATERIAL' | 'TOPIC';

  @IsUUID()
  sourceId!: string;
}
