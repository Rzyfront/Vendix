/**
 * ADR-15 §4 (CP-pos-exclusive-tax-double-charge, unificación remisión-gateway)
 * — contrato de un renderizador PDF registrado detrás de `engine:'pdf'` en
 * `PrintGatewayService.renderDocument`.
 *
 * A diferencia de `IDocumentDataProvider` (siempre 1 provider por
 * `format_type`, siempre HTML), UN MISMO renderizador puede cubrir varios
 * `format_type` — `FiscalInvoicePdfRenderService` distingue factura de nota
 * crédito por la propia fila del documento (`invoices.invoice_type`), no por
 * su identidad de clase. Por eso `DocumentPdfRendererRegistry.register()`
 * recibe el `formatType` como parámetro explícito en vez de leerlo de una
 * propiedad fija del renderizador.
 */
export interface IDocumentPdfRenderer {
  renderBuffer(
    storeId: number,
    documentId: number | string,
    formatType?: string,
  ): Promise<Buffer>;
}
