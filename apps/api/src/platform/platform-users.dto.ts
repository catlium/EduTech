import { IsString, MaxLength, MinLength } from 'class-validator';

export class GrantPlatformRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  roleKey!: string;
}