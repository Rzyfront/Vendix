import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Public DTO for creating a PQR (Petición / Queja / Reclamo).
 *
 * Used by:
 * - Public form (no auth, from any store's home page)
 * - Authenticated customers (via the same endpoint, with user context)
 *
 * Validation enforced via class-validator — the backend returns 400
 * with field-level error messages on failure.
 */
export class CreatePqrPublicDto {
  @IsIn(['PETITION', 'COMPLAINT', 'CLAIM'])
  pqr_type: 'PETITION' | 'COMPLAINT' | 'CLAIM';

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(255)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(5000)
  description: string;
}
