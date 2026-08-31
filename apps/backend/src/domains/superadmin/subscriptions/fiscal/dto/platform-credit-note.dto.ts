import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

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

  @IsInt({ message: 'quantity debe ser entero.' })
  @Min(1, { message: 'quantity debe ser >= 1.' })
  quantity!: number;

  @IsOptional()
  unit_price?: number;
}

/**
 * DTO plataforma para nota crédito. Espejo del CreateCreditNoteDto tienda
 * (mismas reglas: related_invoice_id + note_concept_code obligatorios),
 * sin los items requeridos: la nota TOTAL es válida y se acepta sin líneas.
 *
 * El `customer` NO es obligatorio: la nota plataforma hereda el destinatario
 * del documento que corrige. Si el caller quiere override, lo manda
 * (mismo patrón que `customer.legal_name_override` del riel tienda).
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

  /**
   * Override opcional del destinatario (snapshot heredado del documento
   * relacionado si no se manda).
   */
  @IsOptional()
  customer?: {
    legal_name?: string;
    tax_id?: string;
    tax_id_dv?: string;
    email?: string;
    address_line?: string;
    city?: string;
    department_code?: string;
  };

  /**
   * Perfil plataforma a aplicar como punto de partida (mismo campo que
   * CreatePlatformSalesInvoiceDto.profile_id — ver C.1 del plan).
   */
  @IsOptional()
  @IsInt({ message: 'profile_id debe ser entero positivo.' })
  @Min(1, { message: 'profile_id debe ser entero positivo.' })
  profile_id?: number;
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

  @IsOptional()
  customer?: {
    legal_name?: string;
    tax_id?: string;
    tax_id_dv?: string;
    email?: string;
    address_line?: string;
    city?: string;
    department_code?: string;
  };

  @IsOptional()
  @IsInt({ message: 'profile_id debe ser entero positivo.' })
  @Min(1, { message: 'profile_id debe ser entero positivo.' })
  profile_id?: number;
}
