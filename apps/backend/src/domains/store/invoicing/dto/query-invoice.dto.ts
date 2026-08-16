import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsDateString,
  Max,
  MaxLength,
  Min,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Columnas por las que el listado puede ordenar.
 *
 * `sort_by` viaja tal cual a `orderBy: { [sort_by]: sort_order }`. Sin lista
 * blanca, cualquier texto que no sea una columna de `invoices` hacía que Prisma
 * rechazara la consulta y el filtro global lo degradara a `SYS_INTERNAL_001`:
 * `?sort_by=nonexistent_col` era un 500, y `?sort_by=` uno todavía más feo
 * («unexpected empty path», un `Error` pelado sin clase Prisma).
 *
 * No es un agujero de inyección —Prisma parametriza y por eso REVIENTA en vez de
 * ejecutar—, pero sí un 500 sobre una petición mal formada, que es un 400.
 */
export const INVOICE_SORTABLE_COLUMNS = [
  'id',
  'invoice_number',
  'issue_date',
  'due_date',
  'status',
  'invoice_type',
  'total_amount',
  'customer_name',
  'created_at',
  'updated_at',
] as const;

export class QueryInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /**
   * `@Min(1)` y no sólo `@IsNumber()`: el servicio calcula `skip = (page - 1) *
   * limit`, así que `?page=0` producía `skip: -10` y Postgres rechazaba el
   * OFFSET negativo — un 500 por un número que el cliente escribió mal.
   * `@IsInt` además ataja `?page=1.5`, que antes paginaba desde un offset
   * fraccionario.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** Mismo motivo, más un techo: `limit` alimenta `take` sin cota alguna. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 10;

  @IsOptional()
  @IsIn(INVOICE_SORTABLE_COLUMNS, {
    message: `sort_by debe ser una de las columnas ordenables: ${INVOICE_SORTABLE_COLUMNS.join(', ')}.`,
  })
  sort_by?: string = 'created_at';

  /**
   * `@IsIn` y no `@IsString`: el tipo TypeScript no valida nada en runtime, así
   * que `?sort_order=bogus` llegaba a `orderBy` y devolvía 500.
   */
  @IsOptional()
  @IsIn(['asc', 'desc'], {
    message: "sort_order debe ser 'asc' o 'desc'.",
  })
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsIn([
    'draft',
    'validated',
    'sent',
    'accepted',
    'rejected',
    'cancelled',
    'voided',
  ])
  status?: string;

  /**
   * Filtro de tipo de documento.
   *
   * Acepta los 9 valores de `invoice_type_enum` de Prisma para alinear el
   * query DTO con el `CreateInvoiceDto` (`support_document`,
   * `support_adjustment_note`, `pos_equivalent_document`,
   * `equivalent_adjustment_note` ya eran aceptados en POST; el filtro del
   * listado solo aceptaba 5 antes de QUI-682).
   */
  @IsOptional()
  @IsIn([
    'sales_invoice',
    'purchase_invoice',
    'credit_note',
    'debit_note',
    'export_invoice',
    'support_document',
    'support_adjustment_note',
    'pos_equivalent_document',
    'equivalent_adjustment_note',
  ])
  invoice_type?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  customer_id?: number;

  /**
   * Lookup por CUDS (Código Único de Documento Soporte). El CUDS se almacena en
   * `invoices.cufe` (la columna física carga indistintamente CUFE/CUDE/CUDS por
   * diseño del proveedor UBL); por eso la búsqueda es por `cufe` sin cambiar
   * el esquema. Sólo aplica a documentos soporte y notas de ajuste, pero se
   * acepta en cualquier query — un CUDS que no existe devuelve 200 vacío, nunca
   * 500 (ver `invoicing.service.ts` → `findAll`).
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  cuds?: string;

  /**
   * NOTA para quien añada un campo: todo lo que entre por aquí llega al `where`
   * de Prisma. Un campo sin validador de forma no produce «filtro ignorado»,
   * produce un 500 — es exactamente lo que pasaba con `sort_by` y `page`.
   */

  /**
   * Filtra los documentos soporte (y sus notas de ajuste) por proveedor.
   * Aplica `where.supplier_id = N` cuando el query lo trae; en combinación con
   * `invoice_type=support_document` da el reporte "Documentos soporte por
   * proveedor" sin necesidad de un endpoint dedicado.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  supplier_id?: number;
}

/**
 * Rango de fechas de `GET /store/invoicing/stats`.
 *
 * Existe porque ese endpoint recibía sus dos fechas como `@Query('date_from')`
 * sueltos —strings crudos, sin DTO y por tanto sin `ValidationPipe`— y el
 * servicio hacía `new Date(date_from)` con lo que llegara. Un
 * `?date_from=notadate` producía un `Invalid Date` que Prisma rechazaba: 500
 * sobre una fecha mal tecleada. Con DTO son 400 y dicen qué formato se espera.
 *
 * Además cierra el hueco de `forbidNonWhitelisted`: los `@Query()` por nombre no
 * rechazan claves desconocidas, un objeto DTO sí.
 */
export class QueryInvoiceStatsDto {
  @IsOptional()
  @IsDateString(
    {},
    { message: 'date_from debe ser una fecha ISO 8601 (ej. "2026-01-01").' },
  )
  date_from?: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'date_to debe ser una fecha ISO 8601 (ej. "2026-12-31").' },
  )
  date_to?: string;
}
