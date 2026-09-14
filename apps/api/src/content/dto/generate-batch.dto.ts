import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ContentPackageTypeEnum, GenerationSourceTypeEnum } from '@catlium/contracts';

export class GenerateBatchDto {
  @IsIn(GenerationSourceTypeEnum.options)
  sourceType!: (typeof GenerationSourceTypeEnum.options)[number];

  @IsUUID()
  sourceId!: string;

  @IsEnum(ContentPackageTypeEnum.enum, { each: true })
  types!: string[];

  /** `missing` (default) skips types whose derived resource already exists;
   * `regenerate` forces a fresh generation (dedup still bumps one item). */
  @IsOptional()
  @IsEnum(['missing', 'regenerate'] as const)
  mode?: 'missing' | 'regenerate';
}
