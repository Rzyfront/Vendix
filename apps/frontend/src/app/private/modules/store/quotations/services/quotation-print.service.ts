import { Injectable, inject } from '@angular/core';
import { DocumentPrintService } from '../../../../../shared/services/print';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { Quotation } from '../interfaces/quotation.interface';

@Injectable({
  providedIn: 'root',
})
export class QuotationPrintService {
  private readonly documentPrint = inject(DocumentPrintService);
  private readonly toast = inject(ToastService);

  /**
   * C.5 (R-5) — sin `fallbackRequest`: el emisor local componía dinero
   * (Subtotal/Impuestos/Total) sin base declarada. Si el gateway falla, se dice.
   */
  async printQuotation(quotation: Quotation): Promise<void> {
    const result = await this.documentPrint.printViaGateway({
      formatType: 'quotation',
      documentId: quotation.id,
      title: `Cotización ${quotation.quotation_number}`,
    });
    if (!result) {
      this.toast.error(
        'No se pudo imprimir la cotización: reintenta; si persiste, revisa el Hub de formatos de impresión.',
      );
      throw new Error('print-gateway-unavailable(quotation)');
    }
  }
}
