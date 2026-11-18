import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import { CreateFacturaInvoiceItemDto } from './create-invoice.dto';
import { IsWithinFiscalIssueDateWindow } from './invoice-issue-date-window.validator';
import { InvoiceWithholdingInputDto } from './invoice-withholding-input.dto';

const blankToUndefined = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Cuerpo de `POST /store/invoicing/purchase-orders/:id/support-document`
 * (QUI-684). El proveedor NO viaja aquí: siempre es el de la OC. Tampoco hay
 * `purchase_order_id` en el cuerpo: sale de la ruta.
 *
 * `items` NO lleva `@ArrayMinSize`: una lista vacía es un dato faltante de la
 * OC (`ITEMS_REQUIRED`) y debe responder 422 con la lista de faltantes, no 400.
 */
export class CreatePurchaseOrderSupportDocumentDto {
  @IsDateString(
    {},
    { message: 'issue_date debe ser una fecha ISO 8601 (ej. "2026-08-15").' },
  )
  @IsWithinFiscalIssueDateWindow()
  issue_date: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsDateString(
    {},
    { message: 'due_date debe ser una fecha ISO 8601 (ej. "2026-09-15").' },
  )
  due_date?: string;

  @IsIn(['1', '2'], {
    message: "payment_form debe ser '1' (contado) o '2' (crédito).",
  })
  payment_form: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(3)
  payment_means_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsNumber({}, { message: 'withholding_amount debe ser un número.' })
  @Type(() => Number)
  @Min(0, { message: 'withholding_amount no puede ser negativo.' })
  withholding_amount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceWithholdingInputDto)
  @ArrayMaxSize(20)
  withholdings?: InvoiceWithholdingInputDto[];

  @IsArray({ message: 'items debe ser un arreglo de líneas.' })
  @ArrayMaxSize(100, { message: 'El documento admite máximo 100 líneas.' })
  @ValidateNested({ each: true })
  @Type(() => CreateFacturaInvoiceItemDto)
  items: CreateFacturaInvoiceItemDto[];

  @IsOptional()
  @IsUUID()
  client_request_id?: string;

  @IsOptional()
  @IsBoolean()
  emit_immediately?: boolean;
}
