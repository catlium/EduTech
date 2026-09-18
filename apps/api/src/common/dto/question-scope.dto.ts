import { IsDefined, IsOptional, IsUUID } from 'class-validator';

/** Authoritative question scope for a Paper/Assessment (Subject required,
 * Chapter/Topic optional refinements). The scope is the ONLY source of
 * questions — a pattern never determines, infers or overrides it. Chain
 * consistency (topic in chapter in subject) is validated in the service via
 * resolveScopeChain. */
export class QuestionScopeDto {
  @IsUUID()
  @IsDefined()
  subjectId!: string;

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;
}