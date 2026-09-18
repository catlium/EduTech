import {
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { QuestionScopeDto } from '../../common/dto/question-scope.dto.js';

export class CreateQuestionPaperDto extends QuestionScopeDto {
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

export class SetQuestionPaperScopeDto extends QuestionScopeDto {}

export class GenerateMissingQuestionPaperDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
