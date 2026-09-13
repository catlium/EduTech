import { IsEnum, IsIn, IsUUID } from 'class-validator';
import { ContentPackageTypeEnum } from '@catlium/contracts';

export class GenerateBatchDto {
  @IsIn(['MATERIAL', 'TOPIC'])
  sourceType!: 'MATERIAL' | 'TOPIC';

  @IsUUID()
  sourceId!: string;

  @IsEnum(ContentPackageTypeEnum.enum, { each: true })
  types!: string[];
}