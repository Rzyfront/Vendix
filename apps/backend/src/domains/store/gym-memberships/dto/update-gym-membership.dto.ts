import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO to partially update a membership's editable metadata.
 *
 * Status changes are NOT done here — they go through the explicit transition
 * endpoints (`/suspend`, `/freeze`, `/cancel`, `/reactivate`) so each
 * transition is validated against the current status.
 */
export class UpdateGymMembershipDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  auto_renew?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
