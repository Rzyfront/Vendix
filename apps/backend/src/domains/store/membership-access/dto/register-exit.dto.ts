import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO for registering an exit (occupancy −1). Both fields are optional
 * reference-only metadata (no raw biometric data); the exit itself never
 * depends on them — the count is simply decremented (floored at 0).
 */
export class RegisterExitDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  credential_value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  device_id?: string;
}
