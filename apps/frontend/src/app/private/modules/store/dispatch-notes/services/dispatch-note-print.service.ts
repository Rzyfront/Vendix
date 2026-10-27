import { Injectable, inject } from '@angular/core';
import { DocumentPrintService } from '../../../../../shared/services/print';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import {
  DispatchNote,
  DispatchNoteStatus,
} from '../interfaces/dispatch-note.interface';

/**
 * Estados que se imprimen en lote. Un borrador aún no es documento y una
 * anulada no debe circular; las confirmadas sí, porque la ruta las lleva al
 * cliente antes de entregarlas.
 */
export const BULK_PRINTABLE_DISPATCH_NOTE_STATUSES: readonly DispatchNoteStatus[] = [
  'confirmed',
  'delivered',
  'received',
  'invoiced',
];

export function isBulkPrintableDispatchNote(note: Pick<DispatchNote, 'status'>): boolean {
  return BULK_PRINTABLE_DISPATCH_NOTE_STATUSES.includes(note.status);
}

/** Lo que sale de una impresión en lote, en números de remisión. */
export interface BulkDispatchNotePrintResult {
  printed: number;
  skipped: string[];
  failed: string[];
}

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

  /**
   * Imprime varias remisiones en UN diálogo, cada una con el formato
   * `dispatch_note` configurado en Print Formats (S1/S3/S4). Omite los estados
   * no imprimibles y avisa por número de remisión lo omitido y lo fallido.
   */
  async printDispatchNotes(
    notes: readonly Pick<DispatchNote, 'id' | 'dispatch_number' | 'status'>[],
  ): Promise<BulkDispatchNotePrintResult> {
    const printable = notes.filter(isBulkPrintableDispatchNote);
    const skipped = notes
      .filter((note) => !isBulkPrintableDispatchNote(note))
      .map((note) => note.dispatch_number);

    if (printable.length === 0) {
      this.toast.warning(
        'Ninguna de las remisiones seleccionadas se puede imprimir (borradores o anuladas).',
      );
      return { printed: 0, skipped, failed: [] };
    }

    const result = await this.documentPrint.printGatewayBatch({
      formatType: 'dispatch_note',
      documentIds: printable.map((note) => note.id),
      title: 'Remisiones',
    });
    if (!result) {
      this.toast.error(
        'El formato de impresión de remisiones está inactivo: actívalo en el Hub de formatos de impresión.',
      );
      return { printed: 0, skipped, failed: printable.map((n) => n.dispatch_number) };
    }

    const numberById = new Map(printable.map((note) => [note.id, note.dispatch_number]));
    const failed = result.failedIds.map((id) => numberById.get(Number(id)) ?? String(id));
    if (failed.length > 0) {
      this.toast.error(`No se pudieron imprimir: ${failed.join(', ')}.`);
    }
    if (skipped.length > 0) {
      this.toast.warning(`Omitidas por estado (borrador o anulada): ${skipped.join(', ')}.`);
    }
    return { printed: result.printedIds.length, skipped, failed };
  }
}
