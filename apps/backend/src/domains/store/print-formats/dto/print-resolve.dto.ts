import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * Categoría de documento POS que el caller pide imprimir.
 *
 * NO incluye todos los `print_format_type_enum` — sólo los que el motor
 * POS resuelve a nivel de tienda/orden (ticket, FE, etc.). El resto de los
 * formatos (factura, remisión, cotización,…) son ya documentos fiscales o
 * administrativos cuyo `format_type` lo elige el llamador directamente, sin
 * pasar por la decisión "¿ticket o FE?".
 */
export enum ResolveDocumentTypeEnum {
  POS_ORDER = 'pos_order',
  POS_INVOICE = 'pos_invoice',
}

export class ResolvePrintDocumentDto {
  @IsEnum(ResolveDocumentTypeEnum)
  document_type: ResolveDocumentTypeEnum;

  @IsNotEmpty()
  document_id: number;

  @IsOptional()
  @IsEnum(['html', 'pdf'])
  engine?: 'html' | 'pdf' = 'html';
}

export class ResolvedPrintDocumentDto {
  format_type: string;
  document_id: number;
  engine: 'html' | 'pdf';
  /**
   * Por qué el gate eligió este destino — útil para la UI de preview y para
   * distinguir en auditoría "ya era FE" vs "esta tienda tiene FE activa".
   */
  reason:
    | 'electronic_invoice_already_issued'
    | 'store_has_fe_production'
    | 'no_fiscal_activation';
  /**
   * TRUE cuando el caller debe emitir la FE antes de pedir el render. El
   * motor actual busca la factura por `documentId` y devuelve
   * PRINT_DOCUMENT_NOT_FOUND_001 si no existe; este flag le indica al
   * orquestador del flujo que primero debe gatillar la emisión.
   */
  requires_invoice_emission: boolean;
}