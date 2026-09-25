import { ArrayNotEmpty, IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStudentPlacementDto {
  // The STUDENT membership being placed (student = institute member).
  @IsUUID()
  membershipId!: string;

  // The division the student is placed into; its academic year + class are
  // derived server-side (never client-supplied).
  @IsUUID()
  divisionId!: string;
}

// F.1 — bulk placement: place many STUDENT memberships into ONE division in a
// single atomic request. Duplicate IDs are tolerated (deduplicated server-side);
// the same division/year semantics as single create apply to every member.
export class CreateStudentPlacementsBulkDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  membershipIds!: string[];

  // The shared destination division for every member; its academic year +
  // class are derived server-side (never client-supplied).
  @IsUUID()
  divisionId!: string;
}

export class TransferStudentPlacementDto {
  @IsUUID()
  divisionId!: string;
}

// Q.4.2 — carry-forward (bulk promotion). Preview is a read-only proposal and
// takes an optional class filter; commit is the confirmed plan. The destination
// year is authoritative on commit (never inferred); every item pairs a source
// placement with the exact destination division chosen by the admin after
// reviewing the preview.

export class CarryForwardPreviewDto {
  @IsUUID()
  sourceAcademicYearId!: string;

  @IsUUID()
  destinationAcademicYearId!: string;

  @IsOptional()
  @IsUUID()
  classId?: string;
}

export class CarryForwardItemDto {
  @IsUUID()
  placementId!: string;

  @IsUUID()
  destinationDivisionId!: string;
}

export class CarryForwardCommitDto {
  @IsUUID()
  destinationAcademicYearId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CarryForwardItemDto)
  items!: CarryForwardItemDto[];

  // Placements intentionally left ACTIVE in the source year (repeat class /
  // student leaving): they are never archived, never carried; returned as-is.
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  skipPlacementIds?: string[];
}