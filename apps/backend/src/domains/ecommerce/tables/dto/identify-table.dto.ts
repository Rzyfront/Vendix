import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * QR-por-mesa — Wizard de bienvenida (Step 3).
 *
 * Guest identity payload for a diner who identifies as a "cliente
 * presentado" (name + optional phone/email/document). Only `first_name`
 * is required; the rest are optional dedupe hints consumed by
 * `CustomersService.resolveTableGuestCustomer` (email → phone → fresh row).
 */
export class IdentifyGuestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  first_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  document_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  document_number?: string;
}

/**
 * Identity mode chosen by the diner in the welcome wizard:
 *   - `anonymous`     → no identity; only allowed when the store enables
 *                       `pos.allow_anonymous_sales`.
 *   - `guest`         → "cliente presentado" resolved/created from `guest`.
 *   - `authenticated` → the logged-in customer (JWT `req.user`) is attached.
 */
export type IdentifyMode = 'anonymous' | 'guest' | 'authenticated';

/**
 * QR-por-mesa — Wizard de bienvenida (Step 3).
 *
 * Body for `POST /ecommerce/tables/:token/identify`. `@OptionalAuth` — an
 * authenticated diner brings `req.user`; anonymous/guest diners do not.
 * The `guest` block is required only when `mode === 'guest'` (enforced in
 * the service after resolving the table).
 */
export class IdentifyTableDto {
  @IsIn(['anonymous', 'guest', 'authenticated'])
  mode!: IdentifyMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => IdentifyGuestDto)
  guest?: IdentifyGuestDto;
}
