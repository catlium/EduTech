import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}


export class RequestPasswordResetDto {
  @IsEmail()
  email!: string;
}

// New password policy mirrors registration (users.users.dto / register): a
// password set through a reset must satisfy the exact same minimum length as
// one chosen at signup. Never relax it here alone.
export class ConfirmPasswordResetDto {
  @IsString()
  @MinLength(1)
  rawToken!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
