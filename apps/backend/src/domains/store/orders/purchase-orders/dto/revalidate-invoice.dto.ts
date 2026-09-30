import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Tope del JSON serializado de `consolidated` (se valida en el controller). */
export const REVALIDATE_CONSOLIDATED_MAX_BYTES = 200 * 1024;

/**
 * QUI-855 paso 8a - `POST store/orders/purchase-orders/scan/revalidate`.
 * `scan_attachment_key` es la KEY de S3 devuelta por el escaneo
 * (`scan_attachment.key`), nunca una URL firmada.
 */
export class RevalidateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  scan_attachment_key: string;

  @IsOptional()
  @IsIn(['retail', 'ingredient'])
  order_type?: 'retail' | 'ingredient';

  @IsObject()
  consolidated: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
