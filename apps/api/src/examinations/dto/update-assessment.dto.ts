import {
  IsString,
  IsObject,
  IsInt,
  MaxLength,
  Min,
  Max,
  IsISO8601,
  ValidateIf,
} from 'class-validator';

// All fields optional. Unlike @IsOptional, @ValidateIf((_o, v) => v !== undefined)
// also REJECTS explicit null for non-nullable fields (matches
// UpdateAssessmentRequestSchema, where only startsAt/endsAt/description/
// durationMinutes/maxMarks/instructions are nullable). No status, no
// instituteId — PATCH can never change state or tenant (whitelist → 400);
// status transitions are dedicated endpoints (08-03).
export class UpdateAssessmentDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(255)
  title?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes?: number;

  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(10000)
  maxMarks?: number;

  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  instructions?: Record<string, unknown>;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsISO8601()
  startsAt?: string | null;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsISO8601()
  endsAt?: string | null;
}