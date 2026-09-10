import { IsEmail, IsIn, IsString, MinLength, MaxLength } from 'class-validator';

const ALLOWED_ROLES = ['TEACHER', 'STUDENT'] as const;

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  // Only TEACHER/STUDENT. Institute admins are provisioned through the
  // controlled onboarding path, never via self-service user creation.
  @IsIn(ALLOWED_ROLES)
  role!: string;
}

export class UpdateUserStatusDto {
  @IsIn(['active', 'deactivated'])
  status!: string;
}
