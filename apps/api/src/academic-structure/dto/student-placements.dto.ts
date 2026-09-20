import { IsUUID } from 'class-validator';

export class CreateStudentPlacementDto {
  // The STUDENT membership being placed (student = institute member).
  @IsUUID()
  membershipId!: string;

  // The division the student is placed into; its academic year + class are
  // derived server-side (never client-supplied).
  @IsUUID()
  divisionId!: string;
}

export class TransferStudentPlacementDto {
  @IsUUID()
  divisionId!: string;
}