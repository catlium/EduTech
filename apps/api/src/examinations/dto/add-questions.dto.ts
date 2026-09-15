import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { IsObject } from 'class-validator';

export class AddQuestionsDto {
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  @ArrayMinSize(1)
  questionIds!: string[];

  // Per-question marks override (optional, backward compatible). Values are
  // asserted integer 1..1000 in the service, not here — the shape is dynamic.
  @IsOptional()
  @IsObject()
  marks?: Record<string, number>;

  // Per-question paper-pattern section (optional). A freeform label truncated
  // to 100 chars in the service; 'General' when absent.
  @IsOptional()
  @IsObject()
  sections?: Record<string, string>;
}
