import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Platform-plane institute provision (institute-lifecycle §5/§6). SUPER_ADMIN
 * only (AccessTokenGuard → PlatformGuard, institutes.create). The slug, when
 * supplied, must be kebab-case; omitted it is derived from `name`.
 * `planCode` defaults to `starter` (the provision flow attaches the
 * subscription ledger row write-once). `primaryAdmin` is optional per §6 — an
 * existing user (by email) is attached, a new one is provisioned (name
 * required) via the documented creation flow.
 */
export class PrimaryAdminDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;
}

export class CreateInstituteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be kebab-case' })
  slug?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  planCode?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PrimaryAdminDto)
  primaryAdmin?: PrimaryAdminDto;
}

/** Rename / metadata only — status transitions are owned by deactivate/reactivate. */
export class UpdateInstituteDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be kebab-case' })
  slug?: string;
}