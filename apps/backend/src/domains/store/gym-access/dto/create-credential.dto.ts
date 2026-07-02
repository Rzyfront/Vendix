import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { gym_credential_type_enum } from '@prisma/client';

/**
 * DTO to register an access credential for a member. The credential value is a
 * reference only (external device ref / QR / PIN) — no raw fingerprint data.
 */
export class CreateCredentialDto {
  @IsInt()
  @Type(() => Number)
  customer_id!: number;

  @IsEnum(gym_credential_type_enum)
  credential_type!: gym_credential_type_enum;

  @IsString()
  @MaxLength(255)
  credential_value!: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;
}
