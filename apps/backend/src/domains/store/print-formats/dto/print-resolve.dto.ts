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
   * Por qué el gate eligió este destino. Debe coincidir EXACTAMENTE con
   * `PrintFiscalGateService.PrintTarget.reason` — el frontend usa este
   * valor para decidir el mensaje que se muestra al cajero cuando el
   * render no devuelve lo que pidió, y un valor fuera del contrato
   * deja al cajero con un botón que no hace nada y sin explicación
   * (el mismo síntoma del bug original del dueño).
   *
   * `fe_pending_emission` describe lo que el motor de impresión va a
   * renderizar (ticket), no el estado fiscal del tenant — la tienda
   * tiene FE activa pero el destino es tiquete porque imprimir no
   * emite; la emisión le corresponde al flujo de venta.
   */
  reason:
    | 'electronic_invoice_already_issued'
    | 'fe_pending_emission'
    | 'no_fiscal_activation';
  /**
   * TRUE cuando el caller debe emitir la FE antes de pedir el render. El
   * motor actual busca la factura por `documentId` y devuelve
   * PRINT_DOCUMENT_NOT_FOUND_001 si no existe; este flag le indica al
   * orquestador del flujo que primero debe gatillar la emisión.
   */
  requires_invoice_emission: boolean;
}