import { IsString, IsUUID, IsOptional, IsObject, MaxLength, MinLength } from 'class-validator';

export class CreateTextSyllabusDto {
  @IsUUID()
  subjectId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  program?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  academicYear?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(200000)
  text!: string;
}

export class UpdateSyllabusDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  program?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  academicYear?: string | null;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  structure?: Record<string, unknown> | null;
}

export class UploadSyllabusDto {
  @IsUUID()
  subjectId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  program?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  academicYear?: string | null;
}
