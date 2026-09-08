import { IsObject, IsUUID } from 'class-validator';

export class StartAttemptDto {
  @IsUUID()
  assessmentId!: string;
}

export class SaveAttemptAnswerDto {
  @IsObject()
  answer!: Record<string, unknown>;
}