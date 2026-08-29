import { Injectable, inject } from '@angular/core';
import {
  DocumentPrintService,
  type PrintResult,
  type PrintTrigger,
} from '../../../../../shared/services/print/document-print.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
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
 * QUI-731 (D.2): la cola FIFO (concurrencia 1) vive AQUÍ, no en
 * `DocumentPrintService`. Ese servicio es un singleton de toda la app con 16
 * consumidores; serializarlo encolaría una remisión detrás del recibo del
 * cajero y sumaría los timeouts (3 s + 15 s) en pantallas que este tiquete
 * nunca pidió tocar (§Non-Goals prohíbe rediseñar el motor). Esta cola serializa
 * SOLO los tiquetes de despacho.
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
  private readonly toast = inject(ToastService);

  /**
   * Cola FIFO (concurrencia 1) para los tiquetes de despacho.
   *
   * `printViaGateway`/`sendToPrinter` crean un `<iframe>` nuevo por llamada y
   * esperan hasta 18 s (3 s de documento + 15 s de imágenes) antes de abrir el
   * diálogo del navegador. Sin cola, 20 confirmaciones seguidas en hora pico
   * apilan diálogos de impresión o pierden tickets en silencio. Esta cola las
   * serializa: cada tiquete sale en orden, un diálogo a la vez.
   */
  private printChain: Promise<void> = Promise.resolve();

  private enqueuePrint<T>(job: () => Promise<T>): Promise<T> {
    const result = this.printChain.then(() => job());
    // La cadena nunca se envenena: un job que falla no impide correr el
    // siguiente. El caller de ESE job recibe el rechazo; la cola sigue.
    this.printChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async printDispatchTicket(
    data: DispatchTicketData,
    trigger: PrintTrigger = 'explicit',
  ): Promise<PrintResult | null> {
    return this.enqueuePrint(async () => {
      const fallbackRequest = {
        document: 'dispatch_ticket' as const,
        body: this.buildLegacyBody(data),
        title: `Despacho #${data.orderNumber}`,
        trigger,
      };

      try {
        const result = await this.documentPrint.printViaGateway({
          formatType: 'dispatch_ticket',
          documentId: data.orderId,
          title: `Despacho #${data.orderNumber}`,
          trigger,
          fallbackRequest,
        });

        this.logPrintOutcome(data, trigger, result);
        return result;
      } catch (err) {
        console.error(
          `[QUI-731] Falló la impresión del tiquete de despacho #${data.orderNumber}`,
          this.logContext(data, trigger, err),
        );
        throw err;
      }
    });
  }

  /**
   * Auto-impresión con feedback visible para el operador (QUI-731 / D.2).
   *
   * El POS NO usa este método — conserva su comportamiento idéntico vía
   * `printDispatchTicket` (sin toast). Este wrapper añade el toast discreto de
   * éxito y el toast persistente y accionable de fallo, y re-lanza para que el
   * caller pueda dejar rastro si lo desea.
   */
  async autoPrintDispatchTicket(data: DispatchTicketData): Promise<void> {
    try {
      const result = await this.printDispatchTicket(data, 'automatic');
      if ((result?.documents ?? 0) > 0) {
        this.toast.success('Tiquete de despacho enviado a imprimir');
      }
      // `copies === 0` con trigger 'automatic' significa que el comercio pidió
      // no imprimir este documento: no es un fallo, no hay nada que avisar. El
      // log ya lo registra como omitido.
    } catch (err) {
      this.toast.error(
        'No se pudo imprimir el tiquete de despacho. Puedes reintentarlo con el botón «Imprimir» de la orden.',
        'Tiquete de despacho',
        0, // persistente: no se auto-descarta
      );
      throw err;
    }
  }

  private logPrintOutcome(
    data: DispatchTicketData,
    trigger: PrintTrigger,
    result: PrintResult | null | undefined,
  ): void {
    const documents = result?.documents ?? 0;
    if (documents > 0) {
      console.info('[QUI-731] Tiquete de despacho enviado a impresión', {
        ...this.logContext(data, trigger),
        documents,
        copies: result?.copies ?? 0,
        format: result?.format ?? null,
      });
      return;
    }
    console.info(
      '[QUI-731] Tiquete de despacho omitido (el comercio no imprime esta copia)',
      { ...this.logContext(data, trigger), documents },
    );
  }

  private logContext(
    data: DispatchTicketData,
    trigger: PrintTrigger,
    error?: unknown,
  ): Record<string, unknown> {
    return {
      orderNumber: data.orderNumber,
      orderId: data.orderId,
      trigger,
      timestamp: new Date().toISOString(),
      ...(error !== undefined ? { error } : {}),
    };
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
