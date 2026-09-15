import { Injectable, inject } from '@angular/core';
import { DocumentPrintService } from '../../../../../shared/services/print';
import { Order } from '../interfaces/order.interface';

@Injectable({ providedIn: 'root' })
export class OrderPrintService {
  private readonly documentPrint = inject(DocumentPrintService);

  /**
   * C.5 (R-5) — `generateOrderBody` y su pie de totales, borrados: el emisor
   * local componía dinero sin base declarada y ya era inalcanzable
   * (`printOrder` va por `resolveAndPrint`, sin fallback silencioso: si el
   * gateway falla, el error sube al caller). Nota: el comentario anterior
   * pedía no borrarlo; el plan aprobado C.5 ordena borrarlo y el plan manda.
   *
   * Solo dos formatos, decididos por el backend: ticket POS sin FE,
   * factura electrónica de venta en producción fiscal
   * (`/resolve-for-document`).
   */
  async printOrder(order: Order): Promise<void> {
    try {
      await this.documentPrint.resolveAndPrint({
        documentType: 'pos_order',
        documentId: order.id,
        title: `Orden de Venta #${order.order_number}`,
      });
    } catch (err) {
      console.error(`[OrderPrintService] no se pudo imprimir la orden ${order.id}:`, err);
      throw err;
    }
  }
}
