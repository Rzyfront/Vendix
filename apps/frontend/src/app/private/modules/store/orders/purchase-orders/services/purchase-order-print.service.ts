import { Injectable, inject } from '@angular/core';
import { DocumentPrintService } from '../../../../../../shared/services/print';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { PurchaseOrder } from '../../../inventory/interfaces';

@Injectable({
  providedIn: 'root',
})
export class PurchaseOrderPrintService {
  private readonly documentPrint = inject(DocumentPrintService);
  private readonly toast = inject(ToastService);

  /**
   * C.5 (R-5) — sin `fallbackRequest`: el emisor local componía dinero
   * (Subtotal/IVA/Total) sin base declarada, incluyendo el cómputo
   * local de total de línea que C.6 había mitigado con helper persistido.
   * Borrado el emisor, el helper muere con él. Si el gateway falla, se dice.
   */
  async printPurchaseOrder(order: PurchaseOrder): Promise<void> {
    const result = await this.documentPrint.printViaGateway({
      formatType: 'purchase_order',
      documentId: order.id,
      title: `Orden de Compra ${order.order_number || ''}`,
    });
    if (!result) {
      this.toast.error(
        'No se pudo imprimir la orden de compra: reintenta; si persiste, revisa el Hub de formatos de impresión.',
      );
      throw new Error('print-gateway-unavailable(purchase_order)');
    }
  }
}
