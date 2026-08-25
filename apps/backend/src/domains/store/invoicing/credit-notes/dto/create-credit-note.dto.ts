import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsArray,
  ValidateNested,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CreateInvoiceItemDto,
  CreateInvoiceTaxDto,
} from '../../dto/create-invoice.dto';
import {
  DIAN_CREDIT_NOTE_CONCEPTS,
  DIAN_CREDIT_NOTE_CONCEPT_LABELS,
  DIAN_DEBIT_NOTE_CONCEPTS,
  DIAN_DEBIT_NOTE_CONCEPT_LABELS,
} from '../../providers/dian-direct/constants/dian-note-concepts';

/**
 * Los códigos válidos y el texto del error, derivados del MISMO catálogo que
 * emite el XML. Escribir la lista a mano en el mensaje es como se desincroniza
 * un mensaje de error de su validación.
 *
 * `@IsIn` y no `@IsEnum([...])`: `@IsEnum` con un arreglo produce «must be one
 * of the following values: 0,1,2,3,4» —los ÍNDICES, no los valores—, que es un
 * mensaje que miente. El repo ya migró 60 DTOs por esa razón.
 */
const CREDIT_NOTE_CONCEPT_CODES = Object.values(
  DIAN_CREDIT_NOTE_CONCEPTS,
) as string[];
const DEBIT_NOTE_CONCEPT_CODES = Object.values(
  DIAN_DEBIT_NOTE_CONCEPTS,
) as string[];

function conceptListMessage(
  labels: Readonly<Record<string, string>>,
  document_label: string,
): string {
  const catalog = Object.entries(labels)
    .map(([code, label]) => `«${code}» ${label}`)
    .join(', ');
  return (
    `note_concept_code no es un concepto DIAN válido para una ${document_label}. ` +
    `Valores admitidos: ${catalog}.`
  );
}

export class CreateCreditNoteDto {
  @IsNumber()
  @Type(() => Number)
  related_invoice_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * Concepto de corrección DIAN — `cac:DiscrepancyResponse/cbc:ResponseCode`.
   * '1' devolución parcial · '2' anulación · '3' rebaja o descuento ·
   * '4' ajuste de precio · '5' otros (Anexo Técnico 1.9, tabla 13.2.4).
   *
   * OPCIONAL, no obligatorio, y eso es deliberado: exigirlo rompería a todo
   * cliente de la API que hoy crea notas sin él. Ausente ⇒ el builder emite '2',
   * el literal que escribía antes de que este campo existiera.
   *
   * Es el DATO ESTRUCTURADO. `reason` sigue llevando la prosa que termina en
   * `cbc:Description`; los dos viajan, no se sustituyen.
   */
  @IsOptional()
  @IsIn(CREDIT_NOTE_CONCEPT_CODES, {
    message: conceptListMessage(
      DIAN_CREDIT_NOTE_CONCEPT_LABELS,
      'nota crédito',
    ),
  })
  note_concept_code?: string;

  /**
   * Fecha de emisión de la nota. Opcional: cuando no viene, el servicio la
   * resuelve como HOY en el huso horario de la tienda.
   *
   * Exigirla obligaba al frontend a derivar una fecha fiscal en el navegador,
   * que es justo de donde salen los desfases de un día. El modal de notas nunca
   * la capturó, así que el campo obligatorio sólo producía un 400.
   */
  @IsOptional()
  @IsDateString()
  issue_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  // F.6 — «el mismo análisis» que `description` en `create-invoice.dto.ts`:
  // este campo viajaba SIN techo. El Anexo Técnico 1.9 sí le pone uno a
  // `cbc:Note` de nota crédito/débito —reglas CAD11/DAD11— en 5000
  // caracteres, y `invoice_items`/`invoices` no tienen una columna que lo
  // limite antes: sin este `@MaxLength` un texto más largo llega tal cual al
  // XML y la DIAN lo rechaza DESPUÉS de consumir el consecutivo.
  @IsOptional()
  @IsString()
  @MaxLength(5000, {
    message:
      'notes no puede superar 5000 caracteres (Anexo Técnico DIAN 1.9, reglas CAD11/DAD11 para cbc:Note de nota crédito/débito).',
  })
  notes?: string;

  /**
   * Líneas de la nota. Opcional: sin ellas la nota es TOTAL y el servicio copia
   * las líneas de la factura que corrige, que es el caso más común (anulación)
   * y el único que la UI ofrece hoy.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items?: CreateInvoiceItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];
}

export class CreateDebitNoteDto {
  @IsNumber()
  @Type(() => Number)
  related_invoice_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * Concepto de corrección DIAN — `cac:DiscrepancyResponse/cbc:ResponseCode`.
   * '1' intereses · '2' gastos por cobrar · '3' cambio del valor · '4' otro
   * (Anexo Técnico 1.9, tabla 13.2.5).
   *
   * OJO: el catálogo de la nota DÉBITO es DISTINTO del de la nota crédito y
   * tiene cuatro filas, no cinco. Un '5' es válido en una nota crédito
   * («Otros») y no existe en una nota débito; por eso cada DTO valida contra su
   * propia lista y no contra una unión de las dos.
   *
   * Ausente ⇒ el builder emite '2', el literal histórico.
   */
  @IsOptional()
  @IsIn(DEBIT_NOTE_CONCEPT_CODES, {
    message: conceptListMessage(DIAN_DEBIT_NOTE_CONCEPT_LABELS, 'nota débito'),
  })
  note_concept_code?: string;

  /**
   * Fecha de emisión de la nota. Opcional: cuando no viene, el servicio la
   * resuelve como HOY en el huso horario de la tienda.
   *
   * Exigirla obligaba al frontend a derivar una fecha fiscal en el navegador,
   * que es justo de donde salen los desfases de un día. El modal de notas nunca
   * la capturó, así que el campo obligatorio sólo producía un 400.
   */
  @IsOptional()
  @IsDateString()
  issue_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  // F.6 — «el mismo análisis» que `description` en `create-invoice.dto.ts`:
  // este campo viajaba SIN techo. El Anexo Técnico 1.9 sí le pone uno a
  // `cbc:Note` de nota crédito/débito —reglas CAD11/DAD11— en 5000
  // caracteres, y `invoice_items`/`invoices` no tienen una columna que lo
  // limite antes: sin este `@MaxLength` un texto más largo llega tal cual al
  // XML y la DIAN lo rechaza DESPUÉS de consumir el consecutivo.
  @IsOptional()
  @IsString()
  @MaxLength(5000, {
    message:
      'notes no puede superar 5000 caracteres (Anexo Técnico DIAN 1.9, reglas CAD11/DAD11 para cbc:Note de nota crédito/débito).',
  })
  notes?: string;

  /**
   * Líneas de la nota. Opcional: sin ellas la nota es TOTAL y el servicio copia
   * las líneas de la factura que corrige, que es el caso más común (anulación)
   * y el único que la UI ofrece hoy.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items?: CreateInvoiceItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];
}
