import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { IDocumentPdfRenderer } from '../interfaces/document-pdf-renderer.interface';
import { DispatchNotePdfService } from '../../dispatch-notes/pdf/dispatch-note-pdf.service';

/**
 * ADR-15 §4 (CP-pos-exclusive-tax-double-charge, unificación
 * remisión-gateway) — motor PDF DELGADO de `dispatch_note` detrás del
 * gateway. NO reescribe el PDF ni lo porta a HTML: delega íntegro en
 * `DispatchNotePdfService.generatePdf`, el builder pdfkit
 * (`dispatch-note-pdf.builder.ts`) que ya produce el papel que hoy conoce el
 * comerciante. La unificación es de TRANSPORTE — un solo endpoint de entrada
 * (`POST /store/dispatch-notes/:id/pdf` → `PrintGatewayService`) — no de
 * motor de render, que sigue siendo pdfkit detrás del gateway.
 *
 * `storeId` no se reenvía a `generatePdf`: `DispatchNotePdfService` usa
 * `StorePrismaService`, que ya aísla `dispatch_notes` por tienda a través del
 * `RequestContext` (AsyncLocalStorage) de la MISMA petición HTTP que originó
 * esta llamada. Repetir el filtro aquí no sumaría aislamiento — sólo un
 * segundo lugar donde ese filtro pudiera divergir del primero.
 *
 * `forwardRef`: `DispatchNotePdfService` vive en `DispatchNotesModule`, que a
 * su vez importa `PrintFormatsModule` para que su controller use
 * `PrintGatewayService` (ver `dispatch-notes.module.ts`). Ciclo de módulos
 * resuelto en ambas direcciones — ver el comentario gemelo en
 * `print-formats.module.ts`.
 */
@Injectable()
export class DispatchNotePdfRenderer implements IDocumentPdfRenderer {
  constructor(
    @Inject(forwardRef(() => DispatchNotePdfService))
    private readonly dispatchNotePdfService: DispatchNotePdfService,
  ) {}

  async renderBuffer(
    _storeId: number,
    documentId: number | string,
  ): Promise<Buffer> {
    const id = Number(documentId);
    return this.dispatchNotePdfService.generatePdf(id);
  }
}
