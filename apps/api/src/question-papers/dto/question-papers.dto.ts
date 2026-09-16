import { IsDefined, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateQuestionPaperDto {
  @IsUUID()
  @IsDefined()
  patternId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class RenameQuestionPaperDto {
  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(255)
  title!: string;
}