import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  identification_type_enum,
  persona_type_enum,
  tax_regime_enum,
} from '@prisma/client';

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
 * Every other field mirrors `CreateCustomerDto` but with **looser**
 * validation — no `@DocumentNumberMatchesType`, no `@NitDvMatches`,
 * no `@JuridicaNameRule`, no `@FiscalResponsibilityInCatalogRule`.
 * The resolve endpoint is a quick POS lookup-and-save flow: the
 * cashier may not have every DIAN-grade field at hand. Strict
 * validation belongs to the dedicated create endpoint.
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
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsOptional()
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email?: string | null;

  @IsOptional()
  @IsString()
  first_name?: string | null;

  @IsOptional()
  @IsString()
  last_name?: string | null;

  @IsOptional()
  @IsString()
  legal_name?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsEnum(identification_type_enum, {
    message: 'document_type debe ser uno de los códigos DIAN válidos',
  })
  document_type?: (typeof identification_type_enum)[keyof typeof identification_type_enum] | null;

  /**
   * Permissive: any non-empty string is accepted. The lookup normalizes
   * (uppercase + strip `[\s\-.]`) before comparing. If the match fails
   * and the customer is new, `create()` will enforce the strict format.
   */
  @IsOptional()
  @IsString()
  document_number?: string | null;

  @IsOptional()
  @IsString()
  verification_digit?: string | null;

  @IsOptional()
  @IsEnum(tax_regime_enum, {
    message: 'tax_regime debe ser uno de los regímenes tributarios válidos',
  })
  tax_regime?: (typeof tax_regime_enum)[keyof typeof tax_regime_enum] | null;

  @IsOptional()
  @IsEnum(persona_type_enum, {
    message: "person_type debe ser 'NATURAL' o 'JURIDICA'",
  })
  person_type?: (typeof persona_type_enum)[keyof typeof persona_type_enum] | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  fiscal_responsibilities?: string[];

  @IsOptional()
  @IsString()
  ciiu_code?: string | null;

  @IsOptional()
  @IsBoolean()
  is_withholding_agent?: boolean;

  /**
   * QUI-734 (B.4) — Resolución quick-sale por nombre. Cuando `true`, la
   * búsqueda salta email/documento y solo intenta por nombre:
   *   - 1 coincidencia  → devuelve el cliente existente (`matched_by='name'`).
   *   - >1 coincidencias → 409 (ERR-03): el nombre es ambiguo.
   *   - 0 coincidencias → crea cliente con solo first_name/last_name.
   * El frontend lo envía solo cuando el cajero tipea nombre sin email/doc.
   */
  @IsOptional()
  @IsBoolean()
  name_only?: boolean;
}
