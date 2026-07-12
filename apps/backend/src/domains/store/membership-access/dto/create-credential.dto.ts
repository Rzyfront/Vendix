import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { membership_credential_type_enum } from '@prisma/client';

/**
 * DTO to register an access credential for a member.
 *
 * Generation policy (Anotación 2b):
 *   - `qr`        → `credential_value` is OPTIONAL. Backend auto-generates a
 *     32-char hex string (`crypto.randomBytes(16)`) and verifies uniqueness
 *     against the active-credential index. The generated value is returned
 *     in the create response exactly once.
 *   - `pin`       → `credential_value` is OPTIONAL. Backend auto-generates a
 *     6-digit numeric PIN and verifies uniqueness.
 *   - `external_ref` → `credential_value` is REQUIRED. This is the device-side
 *     fingerprint / SDK reference — Vendix never stores the biometric template
 *     (Ley 1581). The reference MUST be supplied by the operator.
 *
 * The `external_ref` branch is enforced with `@ValidateIf` so class-validator
 * rejects an empty `credential_value` for that type at the controller boundary
 * — the service also re-checks defensively, but a clean 4xx at the pipe level
 * is friendlier.
 */
export class CreateCredentialDto {
  @IsInt()
  @Type(() => Number)
  customer_id!: number;

  @IsEnum(membership_credential_type_enum)
  credential_type!: membership_credential_type_enum;

  @IsOptional()
  @ValidateIf(
    (o: CreateCredentialDto) =>
      o.credential_type === membership_credential_type_enum.external_ref,
  )
  @IsString()
  @MaxLength(255)
  credential_value?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;
}
