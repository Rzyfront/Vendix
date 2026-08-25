import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { identification_type_enum } from '@prisma/client';

/**
 * QUI-723 — Input for `POST /store/customers/resolve`.
 *
 * Distinct from `CreateCustomerDto` in ONE important way:
 *   - `document_number` has NO format cross-validation
 *     (`@DocumentNumberMatchesType()` is intentionally skipped).
 *
 * Why: the resolve endpoint first runs a lookup against existing rows,
 * which may have been stored under legacy data with non-canonical numbers.
 * A 400 at the validation layer would block the cashier from finding an
 * existing customer just because they typed the number with one extra
 * digit, or with a separator, or in a format that doesn't match the
 * strict CC/CE/NIT regex.
 *
 * When the lookup finds no match, the request is delegated to `create()`
 * which still goes through `CreateCustomerDto` validation on its own
 * route — so garbage in a "new customer" path is still rejected, just at
 * the right place (the create endpoint, not the lookup endpoint).
 *
 * Every field is optional. The service treats empty / missing as
 * "this identifier is not being supplied", and requires AT LEAST one
 * of: email, document_type+document_number — otherwise
 * `findOrCreateByEmailOrDocument` returns 422.
 */
export class ResolveCustomerDto {
  @IsOptional()
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email?: string;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  legal_name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(identification_type_enum, {
    message: 'document_type debe ser uno de los códigos DIAN válidos',
  })
  document_type?: identification_type_enum;

  /**
   * Permissive: any non-empty string is accepted. The lookup normalizes
   * (uppercase + strip `[\s\-.]`) before comparing. If the match fails
   * and the customer is new, `create()` will enforce the strict format.
   */
  @IsOptional()
  @IsString()
  document_number?: string;

  @IsOptional()
  @IsString()
  verification_digit?: string;
}
