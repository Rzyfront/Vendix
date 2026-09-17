import { Injectable, inject } from '@angular/core';
import { DocumentPrintService } from '../../../../../shared/services/print';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { DispatchNote } from '../interfaces/dispatch-note.interface';

@Injectable({
  providedIn: 'root',
})
export class DispatchNotePrintService {
  private readonly documentPrint = inject(DocumentPrintService);
  private readonly toast = inject(ToastService);

  /**
   * C.5 (R-5) — sin `fallbackRequest`: el emisor local componía dinero
   * (Subtotal/IVA/Total) sin base declarada. Si el gateway falla, se dice.
   */
  async printDispatchNote(dispatch_note: DispatchNote): Promise<void> {
    const result = await this.documentPrint.printViaGateway({
      formatType: 'dispatch_note',
      documentId: dispatch_note.id,
      title: `Remision ${dispatch_note.dispatch_number}`,
    });
    if (!result) {
      this.toast.error(
        'No se pudo imprimir la remisión: reintenta; si persiste, revisa el Hub de formatos de impresión.',
      );
      throw new Error('print-gateway-unavailable(dispatch_note)');
    }
  }
}
