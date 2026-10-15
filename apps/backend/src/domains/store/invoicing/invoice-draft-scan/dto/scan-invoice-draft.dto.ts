import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_INVOICE_DRAFT_SCAN_NOTE_LENGTH } from '../invoice-draft-scan.types';

/** Campos de texto del multipart de `POST store/invoicing/scan-draft/async`. */
export class ScanInvoiceDraftDto {
  /**
   * Instrucciones libres del usuario, con prioridad sobre los documentos
   * (p.ej. «facturar el 50 % del anticipo, pago a 30 días»).
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_INVOICE_DRAFT_SCAN_NOTE_LENGTH)
  note?: string;
}
