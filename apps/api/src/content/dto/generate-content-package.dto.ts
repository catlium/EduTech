import { ArrayNotEmpty, ArrayUnique, IsIn, IsOptional, IsUUID } from 'class-validator';

type ContentPackageType = 'NOTE' | 'SUMMARY' | 'FLASHCARD_SET' | 'IMPORTANT_CONCEPTS';
const CONTENT_PACKAGE_TYPES: ContentPackageType[] = [
  'NOTE',
  'SUMMARY',
  'FLASHCARD_SET',
  'IMPORTANT_CONCEPTS',
];

export class GenerateContentPackageDto {
  @IsIn(['MATERIAL', 'TOPIC'])
  sourceType!: 'MATERIAL' | 'TOPIC';

  @IsUUID()
  sourceId!: string;

  @IsOptional()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(CONTENT_PACKAGE_TYPES, { each: true })
  includeTypes?: ContentPackageType[];
}
