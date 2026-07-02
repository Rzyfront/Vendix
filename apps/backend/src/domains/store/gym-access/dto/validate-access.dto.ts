import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { gym_credential_type_enum } from '@prisma/client';

/**
 * DTO for the access-validation endpoint. Resolves a member by their active
 * credential and evaluates whether entry is granted. NEVER carries a raw
 * biometric template — only the reference/QR/PIN value stored in
 * `gym_access_credentials`.
 */
export class ValidateAccessDto {
  @IsEnum(gym_credential_type_enum)
  credential_type!: gym_credential_type_enum;

  @IsString()
  @MaxLength(255)
  credential_value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  device_id?: string;
}
