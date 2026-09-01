import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  PRINT_DEFAULTS,
  PRINT_PAGE_GEOMETRY,
  PrintDocument,
  PrintFormat,
  ReceiptsSettings,
} from '../../../core/models/store-settings.interface';
import { PrintFormatType } from '../../../core/models/print-formats.model';
import { StoreSettingsFacade } from '../../../core/store/store-settings/store-settings.facade';
import { PrintGatewayClientService } from './print-gateway-client.service';
import { MmToPxService } from './mm-to-px.service';

/**
 * Upper bound for the print iframe's `load` event. `document.write` + `close()`
 * fires it, but an engine that does not must never hang the print behind it.
 */
const DOCUMENT_READY_TIMEOUT_MS = 3_000;

/**
 * Upper bound for image decoding. A logo whose request never settles would
 * otherwise leave `img.decode()` pending forever and no dialog would ever open.
 */
const IMAGE_DECODE_TIMEOUT_MS = 15_000;

/**
 * Backstop for removing the print iframe when `afterprint` never fires (it does
 * not on every engine, nor when the user dismisses the dialog with the window
 * chrome). Long on purpose: the `setTimeout(() => iframe.remove(), 1000)` that
 * every other emitter still uses is a race — a logo that takes more than a
 * second to decode gets torn down mid-dialog and the sheet comes out blank.
 */
const PRINT_CLEANUP_FALLBACK_MS = 60_000;

/**
 * Why the job is being sent to the printer. It is NOT a presentation decision:
 * it is what makes `copies: 0` mean two different, both-correct things.
 *
 * - `explicit`: somebody pressed "Imprimir". They want paper, so a configured
 *   `0` is clamped to one copy — refusing to print after a click reads as a
 *   broken button.
 * - `automatic`: the flow prints on its own (auto-print after a sale). Here
 *   `0` is the merchant saying "do not print this document", and it is honoured.
 */
export type PrintTrigger = 'explicit' | 'automatic';

/**
 * Per-job escapes from the stored configuration. Every field is a deliberate
 * exception with a named reason; the normal path passes none of them.
 */
export interface PrintOverrides {
  /**
   * Renders a format the merchant has NOT saved yet — the settings preview is
   * the only legitimate caller.
   */
  format?: PrintFormat;
  /**
   * Copy count taken from a source more current than the session snapshot.
   * `receipts` reaches the browser through the `vendix_auth_state` snapshot,
   * which only rehydrates on re-login, so a backend-side batch that read the
   * live row passes the canonical number here.
   */
  copies?: number;
  /** Page margin in millimetres. Ignored on roll formats, same as the stored one. */
  marginMm?: number;
}

/**
 * The paper, resolved. Everything a caller could possibly need to know about
 * presentation, so it never has to look at settings itself.
 */
export interface ResolvedPrintConfig {
  document: PrintDocument;
  format: PrintFormat;
  /** Value of the CSS `@page size` rule. */
  pageSize: string;
  /** Printable width in millimetres — what a body should size itself to. */
  widthMm: number;
  /**
   * Continuous roll (`size: <w>mm auto`): the sheet grows with the content, so
   * one block is always exactly one page. Fixed-height formats can fragment a
   * long body onto a second sheet, which is why a page count over `letter` is
   * only a lower bound.
   */
  isRoll: boolean;
  /** Effective page margin in millimetres. Always 0 on roll formats. */
  marginMm: number;
  /** Copies resolved from settings. May be 0 — see `PrintTrigger`. */
  copies: number;
}

export interface PrintRequest {
  /**
   * Which document this is. The ONLY thing the caller decides about the paper:
   * format, `@page`, margin and copies are resolved from the store's
   * configuration for this document type.
   */
  document: PrintDocument;
  /**
   * Body of the document — the markup that goes inside `<body>`, without any
   * `<html>`, `<head>` or `@page` of its own.
   *
   * An array is a BATCH: each entry is laid out as its own page block and each
   * one is repeated `copies` times contiguously (doc1 ×C, doc2 ×C, …), so the
   * operator splits the stack by document instead of collating by hand.
   */
  body: string | readonly string[];
  /** Title of the print dialog / generated document. */
  title?: string;
  /**
   * Document-specific CSS, appended AFTER the base stylesheet so it wins.
   * The `@page` rule is not negotiable and is not part of this.
   */
  styles?: string;
  /** Defaults to `explicit`. See `PrintTrigger`. */
  trigger?: PrintTrigger;
  /** Deliberate, reasoned exceptions to the stored configuration. */
  overrides?: PrintOverrides;
}

export interface PrintResult {
  /** Bodies actually laid out. 0 means nothing reached the dialog. */
  documents: number;
  /** Sheets sent (`documents × copies`); exact only when `isRoll`. */
  pages: number;
  /** Copies effectively used, after the `PrintTrigger` clamp. */
  copies: number;
  /** Format the job was rendered for. */
  format: PrintFormat;
}

/**
 * Legacy single-format mirrors that predate `receipts.printing`. Read as a
 * fallback so a store that never opened the new screen keeps printing exactly
 * as it did; `printing[doc]` always wins over them.
 */
interface LegacyPrintMirror {
  format?: PrintFormat;
  copies?: number;
}

function legacyMirror(
  document: PrintDocument,
  receipts: ReceiptsSettings | null,
): LegacyPrintMirror {
  switch (document) {
    case 'pos_ticket':
      return {
        format: receipts?.pos_ticket_format,
        copies: receipts?.pos_ticket_copies,
      };
    case 'invoice':
      return {
        format: receipts?.invoice_format,
        copies: receipts?.invoice_copies,
      };
    default:
      return {};
  }
}

/**
 * The single point of entry for printing anything from the web app.
 *
 * Before this service there were eleven independent emitters and exactly one of
 * them respected the store's configuration; the other ten hardcoded `@page
 * { size: A4; margin: 20mm }` and tore their iframe down after a fixed second.
 * The engine here is that one correct implementation, extracted verbatim from
 * `PosTicketService`:
 *
 * - the `@page` rule comes from `PRINT_PAGE_GEOMETRY`, never from a template;
 * - format / margin / copies come from `receipts.printing[document]`, per store
 *   and per document type, with `PRINT_DEFAULTS[document]` behind them;
 * - the job waits for the document to parse AND for every image to decode
 *   before calling `print()`, and the iframe is removed on `afterprint`.
 *
 * A caller says WHICH document it wants printed and hands over its body. It
 * decides nothing about the paper.
 */
@Injectable({ providedIn: 'root' })
export class DocumentPrintService {
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly gatewayClient = inject(PrintGatewayClientService);
  private readonly mmToPx = inject(MmToPxService);

  /**
   * Resolves the paper for a document without printing it.
   *
   * Precedence: explicit override → `receipts.printing[document]` → the legacy
   * single-format mirror (`pos_ticket_format` and friends) → `PRINT_DEFAULTS`.
   * An unknown format falls back to the document's default rather than reaching
   * `@page` as a value the browser will silently ignore.
   */
  resolveConfig(
    document: PrintDocument,
    overrides?: PrintOverrides,
  ): ResolvedPrintConfig {
    const receipts = this.storeSettings.receipts();
    const configured = receipts?.printing?.[document];
    const legacy = legacyMirror(document, receipts ?? null);
    const fallback = PRINT_DEFAULTS[document];

    const requested =
      overrides?.format ?? configured?.format ?? legacy.format ?? fallback.format;
    const format: PrintFormat =
      requested && PRINT_PAGE_GEOMETRY[requested] ? requested : fallback.format;
    const geometry = PRINT_PAGE_GEOMETRY[format];

    const requestedCopies =
      overrides?.copies ?? configured?.copies ?? legacy.copies ?? fallback.copies;
    const copies =
      typeof requestedCopies === 'number' && Number.isFinite(requestedCopies)
        ? Math.max(0, Math.trunc(requestedCopies))
        : 1;

    // A margin on a roll is meaningless — the roll has no fixed sheet to inset
    // from — and applying it would just eat printable width on 58 mm paper.
    const requestedMargin =
      overrides?.marginMm ?? configured?.margin_mm ?? fallback.margin_mm;
    const marginMm =
      geometry.is_roll ||
      typeof requestedMargin !== 'number' ||
      !Number.isFinite(requestedMargin)
        ? 0
        : Math.max(0, requestedMargin);

    return {
      document,
      format,
      pageSize: geometry.page_size,
      widthMm: geometry.width_mm,
      isRoll: geometry.is_roll,
      marginMm,
      copies,
    };
  }

  /**
   * The full print document around one or more bodies, ready to hand to a
   * printer or to show as a preview.
   *
   * Exposed because the settings preview must review the EXACT document the
   * printer receives — `@page size` and `@media print` rules included. A
   * preview built by a second code path is how a merchant ends up approving a
   * bordered card on grey and printing something else.
   */
  buildDocumentHtml(
    config: ResolvedPrintConfig,
    bodyHtml: string,
    opts?: { title?: string; styles?: string },
  ): string {
    const margin = config.marginMm > 0 ? `${config.marginMm}mm` : '0';

    return `
      <html>
        <head>
          <title>${opts?.title ?? ''}</title>
          <style>
            /* Without an explicit @page size the driver falls back to its own
               default paper and centres an 80 mm ticket on a letter sheet. */
            @page { size: ${config.pageSize}; margin: ${margin}; }
            html, body { margin: 0; padding: 0; }
            @media print { html, body { background: #fff; } }
            ${opts?.styles ?? ''}
          </style>
        </head>
        <body>${bodyHtml}</body>
      </html>
    `;
  }

  /**
   * Resolves the paper, lays the bodies out and sends the job to the printer.
   *
   * Resolves once the document reached the print dialog with its images
   * decoded — not when the iframe was created.
   */
  async print(request: PrintRequest): Promise<PrintResult> {
    const config = this.resolveConfig(request.document, request.overrides);
    const bodies =
      typeof request.body === 'string' ? [request.body] : request.body;

    const copies =
      request.trigger === 'automatic' ? config.copies : Math.max(1, config.copies);

    if (!bodies.length || copies === 0) {
      return { documents: 0, pages: 0, copies: 0, format: config.format };
    }

    const documentHtml = this.buildDocumentHtml(
      config,
      this.composeBlocks(bodies, copies),
      { title: request.title, styles: request.styles },
    );

    await this.sendToPrinter(documentHtml);

    return {
      documents: bodies.length,
      pages: bodies.length * copies,
      copies,
      format: config.format,
    };
  }

  /**
   * Imprime un documento mediante el Print Gateway Centralizado del backend.
   * Si ocurre algún error o el gateway no está disponible, hace fallback
   * transparente al emisor local (legacy).
   */
  async printViaGateway(params: {
    formatType: PrintFormatType;
    documentId: number | string;
    title?: string;
    trigger?: PrintTrigger;
    fallbackRequest?: PrintRequest;
  }): Promise<PrintResult | null> {
    try {
      const response = await firstValueFrom(
        this.gatewayClient.renderDocument(params.formatType, params.documentId, 'html'),
      );

      if (response && response.html) {
        // [print-editor-dsk P2.3] Use the format from the REQUEST instead of
        // reverse-engineering it from width_mm. The width-only heuristic could
        // mis-report a 76mm POS format as thermal_58; the format the gateway
        // was asked for is the source of truth.
        const requestedFormat = params.formatType as unknown as PrintFormat;
        await this.sendToPrinter(response.html);
        return {
          documents: 1,
          pages: response.copies || 1,
          copies: response.copies || 1,
          format: requestedFormat,
        };
      }
    } catch (err) {
      console.warn(
        `[DocumentPrintService] Error en Print Gateway para ${params.formatType}, aplicando fallback local:`,
        err,
      );
    }

    // Fallback a renderizado local en el navegador
    if (params.fallbackRequest) {
      return this.print(params.fallbackRequest);
    }

    return null;
  }

  /**
   * [print-fiscal-gate P3] — Single entry FE para imprimir un documento POS.
   *
   * 1. Consulta `/resolve-for-document` para que el backend decida formato y
   *    documentId según el estado fiscal real de la tienda (no la presencia
   *    póstuma de una factura en la orden, como hacía el switch legacy).
   * 2. Llama a `/render` con esa decisión y entrega el HTML al motor de impresión.
   * 3. SIN fallback silencioso: si el gateway falla, eleva el error al caller.
   *
   * Reemplaza los call-sites previos que decidían formato client-side
   * (`pos-ticket.service.ts:238`, `order-ticket.service.ts:83`).
   */
  async resolveAndPrint(params: {
    documentType: 'pos_order' | 'pos_invoice';
    documentId: number;
    title?: string;
    trigger?: PrintTrigger;
  }): Promise<PrintResult> {
    const resolved = await firstValueFrom(
      this.gatewayClient.resolveDocument(params.documentType, params.documentId, 'html'),
    );

    const response = await firstValueFrom(
      this.gatewayClient.renderDocument(
        resolved.format_type,
        resolved.document_id,
        resolved.engine,
      ),
    );

    if (!response?.html) {
      throw new Error(
        `Print gateway devolvió respuesta sin HTML para ${resolved.format_type} doc ${resolved.document_id}`,
      );
    }

    const requestedFormat = resolved.format_type as unknown as PrintFormat;
    await this.sendToPrinter(response.html);
    return {
      documents: 1,
      pages: response.copies || 1,
      copies: response.copies || 1,
      format: requestedFormat,
    };
  }

  /**
   * Imprime directamente un HTML completo compilado por el Print Gateway (ej: preview o render directo)
   */
  async printGatewayHtml(documentHtml: string): Promise<void> {
    await this.sendToPrinter(documentHtml);
  }

  /**
   * Lays bodies and their copies out as page blocks.
   *
   * Browsers expose no copy count to `window.print()`, so extra copies are
   * extra pages. Every block but the very first opens a new sheet — the same
   * rule for the second copy of one document and for the next document of a
   * batch.
   */
  private composeBlocks(bodies: readonly string[], copies: number): string {
    const blocks: string[] = [];

    for (const body of bodies) {
      for (let copy = 0; copy < copies; copy++) {
        blocks.push(
          blocks.length === 0
            ? body
            : `<div style="break-before: page; page-break-before: always;">${body}</div>`,
        );
      }
    }

    return blocks.join('');
  }

  /**
   * Writes a full print document into a hidden iframe and sends it to the
   * printer, waiting for the document and its images first.
   */
  private async sendToPrinter(documentHtml: string): Promise<void> {
    const iframe = window.document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    window.document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      return;
    }

    doc.open();
    doc.write(documentHtml);
    doc.close();

    await this.awaitDocumentReady(iframe, doc);

    const view = iframe.contentWindow;
    // Registered BEFORE print() because print() blocks on the dialog and
    // `afterprint` can fire the moment it returns.
    this.removeAfterPrint(iframe, view);
    view?.focus();
    view?.print();
  }

  /**
   * Blocks until the document is parsed and every image is decoded.
   *
   * Calling `print()` right after `doc.close()` — what the unmigrated emitters
   * do — is before the logo has been fetched: the on-screen preview shows it
   * (it lives long enough) while the paper comes out without it. Both waits are
   * capped: a broken or hanging image must not make the document unprintable.
   */
  private async awaitDocumentReady(
    iframe: HTMLIFrameElement,
    doc: Document,
  ): Promise<void> {
    if (doc.readyState !== 'complete') {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        iframe.addEventListener('load', done, { once: true });
        setTimeout(done, DOCUMENT_READY_TIMEOUT_MS);
      });
    }

    const images = Array.from(doc.images);
    if (!images.length) return;

    await Promise.race([
      Promise.all(images.map((img) => this.awaitImage(img))),
      new Promise<void>((resolve) =>
        setTimeout(resolve, IMAGE_DECODE_TIMEOUT_MS),
      ),
    ]);
  }

  /**
   * Resolves when an image is fetched AND decoded — or when it has definitively
   * failed. Never rejects: a broken logo must degrade to a document without a
   * logo, not cancel a 600-page job.
   */
  private awaitImage(img: HTMLImageElement): Promise<void> {
    const fetched = img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        });

    return fetched.then(() =>
      typeof img.decode === 'function'
        ? img.decode().catch(() => undefined)
        : undefined,
    );
  }

  /**
   * Tears the iframe down once printing is over. `afterprint` is the fast path
   * (it does not fire on every engine) and the long timeout is the guarantee.
   */
  private removeAfterPrint(
    iframe: HTMLIFrameElement,
    view: Window | null,
  ): void {
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let removed = false;

    const remove = () => {
      if (removed) return;
      removed = true;
      if (fallback !== undefined) clearTimeout(fallback);
      iframe.remove();
    };

    view?.addEventListener('afterprint', remove, { once: true });
    fallback = setTimeout(remove, PRINT_CLEANUP_FALLBACK_MS);
  }
}
