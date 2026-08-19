import { IsString, IsOptional, IsObject, IsIn, MaxLength, IsUUID } from 'class-validator';

type ContentType = 'NOTE' | 'FLASHCARD_SET' | 'CORNELL_NOTE';
type ContentSource = 'MANUAL' | 'AI_GENERATED' | 'OCR_EXTRACTED' | 'IMPORTED';
type ContentChangeType = 'CREATION' | 'EDIT' | 'REGENERATION' | 'CORRECTION';
type ContentStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export class CreateContentDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @IsIn(['NOTE', 'FLASHCARD_SET', 'CORNELL_NOTE'])
  type!: ContentType;

  @IsIn(['MANUAL', 'AI_GENERATED', 'OCR_EXTRACTED', 'IMPORTED'])
  source!: ContentSource;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  renderedHtml?: string;

  @IsOptional()
  @IsObject()
  aiContext?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  sourceReference?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeReason?: string;
}

export class UpdateContentDto {
  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  renderedHtml?: string;

  @IsOptional()
  @IsObject()
  aiContext?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  sourceReference?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['CREATION', 'EDIT', 'REGENERATION', 'CORRECTION'])
  changeType?: ContentChangeType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeReason?: string;
}

export class SetContentStatusDto {
  @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED'])
  status!: ContentStatus;
}
