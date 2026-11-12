import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

import { isDianUnitCode } from '../../../../store/invoicing/providers/dian-direct/constants/dian-unit-codes';
import {
  DIAN_CREDIT_NOTE_CONCEPTS,
  DIAN_CREDIT_NOTE_CONCEPT_LABELS,
  DIAN_DEBIT_NOTE_CONCEPTS,
  DIAN_DEBIT_NOTE_CONCEPT_LABELS,
} from '../../../../store/invoicing/providers/dian-direct/constants/dian-note-concepts';

/**
 * Conceptos DIAN válidos por tipo de nota. Mismo patrón de catálogo que el
 * DTO de tienda: `@IsIn` con `Object.values(...)` y mensaje derivado del MISMO
 * catálogo, sin escribir la lista a mano (desincronización garantizada).
 */
const CREDIT_NOTE_CONCEPT_CODES = Object.values(
  DIAN_CREDIT_NOTE_CONCEPTS,
) as string[];
const DEBIT_NOTE_CONCEPT_CODES = Object.values(
  DIAN_DEBIT_NOTE_CONCEPTS,
) as string[];

const creditMessage =
  `note_concept_code no es un concepto DIAN válido para una nota crédito de la plataforma. ` +
  `Valores admitidos: ` +
  Object.entries(DIAN_CREDIT_NOTE_CONCEPT_LABELS)
    .map(([code, label]) => `«${code}» ${label}`)
    .join(', ') +
  '.';

const debitMessage =
  `note_concept_code no es un concepto DIAN válido para una nota débito de la plataforma. ` +
  `Valores admitidos: ` +
  Object.entries(DIAN_DEBIT_NOTE_CONCEPT_LABELS)
    .map(([code, label]) => `«${code}» ${label}`)
    .join(', ') +
  '.';

function IsDianUnitCodeValue(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isDianUnitCodeValue',
      target: target.constructor,
      propertyName,
      options,
      validator: { validate: (value: unknown) => isDianUnitCode(value) },
    });
}

/**
 * Línea opcional de la nota. La nota TOTAL (sólo motivo) NO lleva items.
 * Si trae, debe respetar la shape mínima que `InvoicingService.create` espera.
 */
class PlatformNoteLineDto {
  @IsString()
  @MinLength(1, { message: 'description es obligatorio.' })
  @MaxLength(500, {
    message: 'description admite hasta 500 caracteres (F.5 del CP-…-parity).',
  })
  description!: string;

  @IsNumber(
    { maxDecimalPlaces: 6 },
    { message: 'quantity debe ser un número con hasta 6 decimales.' },
  )
  @IsPositive({ message: 'quantity debe ser mayor que 0.' })
  quantity!: number;

  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'unit_price debe ser un número con hasta 2 decimales.' },
  )
  @IsPositive({ message: 'unit_price debe ser mayor que 0.' })
  unit_price?: number;

  /** Unidad de medida DIAN (UN/ECE rec. 20). Default 'NIU'; el mes es 'LUN', nunca 'MON'. */
  @IsOptional()
  @IsString()
  @MaxLength(5)
  @IsDianUnitCodeValue({
    message:
      'unit_code no es una unidad de medida DIAN válida (ej. "NIU", "KGM", "LUN" para mes; "MON" no existe).',
  })
  unit_code?: string;
}

/**
 * DTO plataforma para nota crédito. Espejo del CreateCreditNoteDto tienda
 * (mismas reglas: related_invoice_id + note_concept_code obligatorios),
 * sin los items requeridos: la nota TOTAL es válida y se acepta sin líneas.
 *
 * El destinatario NO se envía: la nota plataforma hereda siempre el cliente
 * del documento que corrige (DIAN exige el mismo adquirente). Con
 * `forbidNonWhitelisted`, un `customer` o `profile_id` en el body es un 400.
 */
export class PlatformCreateCreditNoteDto {
  @IsInt({
    message:
      'related_invoice_id debe ser un número entero: los ids de factura no tienen fracciones.',
  })
  @Min(1, {
    message:
      'related_invoice_id mínimo es 1: sin ese vínculo el documento no es válido ante la DIAN.',
  })
  related_invoice_id!: number;

  @IsString()
  @IsIn(CREDIT_NOTE_CONCEPT_CODES, { message: creditMessage })
  note_concept_code!: string;

  @IsString()
  @MaxLength(500, {
    message: 'reason admite hasta 500 caracteres (F.5 — DAD11/FAD11).',
  })
  reason!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlatformNoteLineDto)
  items?: PlatformNoteLineDto[];

}

export class PlatformCreateDebitNoteDto {
  @IsInt({
    message:
      'related_invoice_id debe ser un número entero: los ids de factura no tienen fracciones.',
  })
  @Min(1, {
    message:
      'related_invoice_id mínimo es 1: sin ese vínculo el documento no es válido ante la DIAN.',
  })
  related_invoice_id!: number;

  @IsString()
  @IsIn(DEBIT_NOTE_CONCEPT_CODES, { message: debitMessage })
  note_concept_code!: string;

  @IsString()
  @MaxLength(500, {
    message: 'reason admite hasta 500 caracteres (F.5 — DAD11/FAD11).',
  })
  reason!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlatformNoteLineDto)
  items?: PlatformNoteLineDto[];

}
