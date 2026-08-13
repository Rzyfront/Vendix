import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QueryInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsEnum([
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
  @IsEnum([
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
