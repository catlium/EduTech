import { IsIn, IsUUID } from 'class-validator';

// Phase H — student subject enrollment overrides (D5/§17): EXCLUDE a subject
// the class offfers from one student, or ENROLL a student into a subject their
// class does not offer (elective). `placementId` pins the student + cohort;
// `kind` is explicit inclusion/exclusion — one row per (placement, subject),
// so ENROLLED and EXCLUDED are mutually exclusive for a given student+subject.
export class CreateStudentEnrollmentDto {
  // The ACTIVE student placement the override applies to.
  @IsUUID()
  placementId!: string;

  // An institute subject: EXCLUDED must be offered by the placement's class
  // (it is being removed from that student's set); ENROLLED must NOT be
  // offered by the class (it is being added as an elective).
  @IsUUID()
  subjectId!: string;

  @IsIn(['ENROLLED', 'EXCLUDED'])
  kind!: 'ENROLLED' | 'EXCLUDED';
}