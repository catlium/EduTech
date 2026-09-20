import { IsUUID } from 'class-validator';

export class CreateTeacherAssignmentDto {
  // The TEACHER membership being assigned (teacher = institute member).
  @IsUUID()
  membershipId!: string;

  // The canonical class-subject offering the teacher is assigned to.
  @IsUUID()
  classSubjectId!: string;
}