import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Custom role keys are lowercase (system keys are UPPERCASE, so a custom key
// is structurally never confusable with a built-in one). The service further
// rejects case-insensitive collisions with any built-in role name.
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;

const PERMISSION_KEY_OPTS = {
  each: true,
} as const;

export class CreateRoleDto {
  @Matches(ROLE_KEY_PATTERN)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // Initial permission set (institute-domain catalogue keys only; the service
  // re-validates against the catalogue — never platform/unknown keys).
  @IsArray()
  @ArrayUnique()
  @IsString(PERMISSION_KEY_OPTS)
  @ArrayMaxSize(128)
  permissionKeys!: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class SetRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString(PERMISSION_KEY_OPTS)
  @ArrayMaxSize(128)
  permissionKeys!: string[];
}