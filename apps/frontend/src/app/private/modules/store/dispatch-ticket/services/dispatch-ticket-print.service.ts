import { Injectable, inject } from '@angular/core';
import {
  DocumentPrintService,
  PrintTrigger,
} from '../../../../../shared/services/print/document-print.service';
import { DispatchTicketData } from '../models/dispatch-ticket-data.model';

/**
 * Servicio canónico para imprimir el tiquete de despacho (dispatch_ticket).
 *
 * Sigue el patrón de `DispatchNotePrintService`: delega en
 * `DocumentPrintService.printViaGateway` (que ya implementa el fallback
 * transparente al emisor local) y, si el gateway falla, renderiza un cuerpo
 * legacy a partir de `DispatchTicketData`.
 *
 * Los dos disparadores (POS auto en `pos-order-confirmation maybeAutoPrint/printReceipt`,
 * botón manual en `order-details-page`) consumen este mismo método para no
 * divergir — un cambio de formato o de copy applies uniform.
 *
 * ADR-1: Gateway como única vía de impresión (Enlace Universal).
 * ADR-6: `direct_delivery` NO emite `dispatch_ticket`. La guard del disparador
 * la vive en el caller, no acá.
 * ADR-7: Este servicio respeta `receipts.print_dispatch_ticket_enabled` del
 * caller (Phase E).
 */
@Injectable({ providedIn: 'root' })
export class DispatchTicketPrintService {
  private readonly documentPrint = inject(DocumentPrintService);

  async printDispatchTicket(
    data: DispatchTicketData,
    trigger: PrintTrigger = 'explicit',
  ): Promise<void> {
    const fallbackRequest = {
      document: 'dispatch_ticket' as const,
      body: this.buildLegacyBody(data),
      title: `Despacho #${data.orderNumber}`,
      trigger,
    };

    await this.documentPrint.printViaGateway({
      formatType: 'dispatch_ticket',
      documentId: data.orderId,
      title: `Despacho #${data.orderNumber}`,
      trigger,
      fallbackRequest,
    });
  }

  private buildLegacyBody(data: DispatchTicketData): string {
    const items = data.items
      .map(
        (it, i) =>
          `<tr><td>${i + 1}</td><td>${it.sku}</td><td>${it.productName}</td>` +
          `<td>${it.orderedQty}</td><td>${it.dispatchedQty}</td></tr>`,
      )
      .join('');
    return `
      <header class="dt-header">
        <h1>${data.storeName}</h1>
        <p>Orden #${data.orderNumber} — ${data.dateFormatted}</p>
      </header>
      <section class="dt-customer">
        <strong>${data.customer.name}</strong>
        <p>${data.customer.addressLine1}</p>
        <p>${data.customer.addressLine2 || ''}</p>
        <p>${data.customer.city || ''}</p>
      </section>
      <table class="dt-items">
        <thead><tr><th>#</th><th>SKU</th><th>Producto</th><th>Cant.pedida</th><th>Cant.despachada</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
      <footer class="dt-footer">
        <p>Despachado por:</p><div class="signature"></div>
      </footer>
    `;
  }
}