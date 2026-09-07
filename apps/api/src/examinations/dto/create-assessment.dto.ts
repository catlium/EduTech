import {
  IsString,
  IsOptional,
  IsObject,
  IsInt,
  MaxLength,
  Min,
  Max,
  IsISO8601,
  IsDefined,
  MinLength,
} from 'class-validator';

export class CreateAssessmentDto {
  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxMarks?: number;

  @IsOptional()
  @IsObject()
  instructions?: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}