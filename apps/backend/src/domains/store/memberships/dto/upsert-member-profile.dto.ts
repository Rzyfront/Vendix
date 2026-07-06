import {
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO to upsert a member profile (1 per store+customer). All fields optional so
 * partial edits are allowed. Sensitive medical data lives here — never a raw
 * biometric template (those stay on the access device).
 */
export class UpsertMemberProfileDto {
  @IsOptional()
  @IsISO8601()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  emergency_contact_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  emergency_contact_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  medical_notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  goals?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  @Max(300)
  height_cm?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0)
  @Max(999)
  weight_kg?: number;
}
