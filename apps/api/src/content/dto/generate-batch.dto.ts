import { IsEnum, IsIn, IsUUID } from 'class-validator';
import { ContentPackageTypeEnum, GenerationSourceTypeEnum } from '@catlium/contracts';

export class GenerateBatchDto {
  @IsIn(GenerationSourceTypeEnum.options)
  sourceType!: (typeof GenerationSourceTypeEnum.options)[number];

  @IsUUID()
  sourceId!: string;

  @IsEnum(ContentPackageTypeEnum.enum, { each: true })
  types!: string[];
}
