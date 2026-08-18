import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class CreateJobDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  type!: string;

  @IsOptional()
  payload?: Record<string, unknown>;
}
