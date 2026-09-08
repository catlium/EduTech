import { IsObject, IsOptional, IsUUID } from 'class-validator';

export class GenerateSyllabusDto {
  @IsOptional()
  @IsUUID()
  materialId?: string;
}

export class UpdateSyllabusDto {
  @IsObject()
  structure!: Record<string, unknown>;
}