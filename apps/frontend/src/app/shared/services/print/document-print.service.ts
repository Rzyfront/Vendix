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
import {
  PrintGeometryMargins,
  resolvePrintGeometry,
} from '../../../core/lib/print-geometry';

/**
 * Defensive CSS injected into every gateway-rendered document. It never touches
 * `@page`: the backend owns paper and margins, this only stops an overflowing
 * image / table / long word from escaping the printable width.
 */
const GATEWAY_GUARD_STYLE =
  '<style data-vx-print-guard>' +
  'html,body{max-width:100%;overflow-wrap:anywhere;}' +
  'img,svg{max-width:100%;height:auto;}' +
  'table{table-layout:fixed;}' +
  '</style>';

/** Base guard stylesheet shared by every locally composed print document. */
const BASE_GUARD_CSS = `
            .vx-print-root *, .vx-print-root *::before, .vx-print-root *::after { box-sizing: border-box; max-width: 100%; }
            .vx-print-root table { table-layout: fixed; width: 100%; }
            .vx-print-root td, .vx-print-root th { overflow-wrap: anywhere; }
            .vx-print-root img, .vx-print-root svg, .vx-print-root canvas { max-width: 100%; height: auto; }
            .vx-print-root pre { white-space: pre-wrap; }`;

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
  /** Page margin in millimetres (sheets: at least 5 mm; rolls: top/bottom only). */
  marginMm?: number;
  /** Printable width of a roll in millimetres; clamped by the geometry kernel. */
  printableWidthMm?: number;
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
  /** Physical paper (page) width in millimetres. */
  paperWidthMm: number;
  /**
   * @deprecated Alias of `paperWidthMm`, kept so older consumers keep compiling.
   * Do NOT size a body to it: use `contentWidthMm`.
   */
  readonly widthMm: number;
  /** Width a body must size itself to: paper minus side margins. */
  contentWidthMm: number;
  /** Width the printer head can physically print (rolls) or content (sheets). */
  printableWidthMm: number;
  /** Effective margin per side, in millimetres. */
  margins: PrintGeometryMargins;
  /**
   * Continuous roll (`size: <w>mm auto`): the sheet grows with the content, so
   * one block is always exactly one page. Fixed-height formats can fragment a
   * long body onto a second sheet, which is why a page count over `letter` is
   * only a lower bound.
   */
  isRoll: boolean;
  /**
   * Uniform summary of the page margin in mm (the largest side). Per-side
   * values live in `margins`.
   */
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

  /** Gateway copy metadata is normalized before body expansion. */
  normalizeGatewayCopies(copies: unknown): number {
    if (typeof copies !== 'number' || !Number.isFinite(copies)) return 1;
    return Math.min(10, Math.max(1, Math.trunc(copies)));
  }

  /**
   * Materializes copies in the HTML body only. The document shell, head and
   * its styles remain byte-for-byte singletons; duplicating complete HTML
   * documents would create invalid nested documents and duplicate @page.
   */
  private expandGatewayHtmlCopies(documentHtml: string, copies: number): string {
    if (copies === 1) return documentHtml;

    const bodyMatch = documentHtml.match(/<body\b[^>]*>[\s\S]*?<\/body\s*>/i);
    if (!bodyMatch) {
      throw new Error('Print gateway HTML has no <body>; cannot safely expand multiple copies.');
    }

    const body = bodyMatch[0];
    const openingTag = body.match(/^<body\b[^>]*>/i)?.[0];
    const closingTag = body.match(/<\/body\s*>$/i)?.[0];
    if (!openingTag || !closingTag) {
      throw new Error('Print gateway HTML has an invalid <body>; cannot safely expand multiple copies.');
    }
    const content = body.slice(openingTag.length, body.length - closingTag.length);
    const expandedBody = `${openingTag}${this.composeBlocks([content], copies)}${closingTag}`;
    return documentHtml.replace(body, () => expandedBody);
  }

  /**
   * Single hook for every gateway-rendered document: expands copies and injects
   * the defensive overflow guard. Does not alter `@page`.
   */
  private prepareGatewayHtml(documentHtml: string, copies: number): string {
    return this.withGatewayPrintGuard(this.expandGatewayHtmlCopies(documentHtml, copies));
  }

  /** Injects `GATEWAY_GUARD_STYLE` once, last in `<head>` (idempotent). */
  withGatewayPrintGuard(documentHtml: string): string {
    if (documentHtml.includes('data-vx-print-guard')) return documentHtml;
    if (/<\/head\s*>/i.test(documentHtml)) {
      return documentHtml.replace(/<\/head\s*>/i, (m) => `${GATEWAY_GUARD_STYLE}${m}`);
    }
    if (/<body\b/i.test(documentHtml)) {
      return documentHtml.replace(/<body\b/i, (m) => `${GATEWAY_GUARD_STYLE}${m}`);
    }
    return `${GATEWAY_GUARD_STYLE}${documentHtml}`;
  }

  /**
   * Print Formats is the authority for automatic printing. Read the detail on
   * each decision (rather than trusting the auth/settings snapshot) so a
   * merchant's latest enable/auto-print choice is honoured. Manual printing
   * deliberately does not call this gate.
   */
  async canAutoPrint(formatType: PrintFormatType): Promise<boolean> {
    try {
      const detail = await firstValueFrom(this.gatewayClient.getFormatDetail(formatType));
      return detail.is_active && detail.definition?.paper?.auto_print !== false;
    } catch {
      // Fail closed: a settings/network failure must never trigger an
      // automatic print based on stale legacy settings.
      return false;
    }
  }

  /** Resolve fiscal routing first, then ask whether that final format may auto-print. */
  async canAutoPrintDocument(
    documentType: 'pos_order' | 'pos_invoice',
    documentId: number,
  ): Promise<boolean> {
    try {
      const resolved = await firstValueFrom(
        this.gatewayClient.resolveDocument(documentType, documentId, 'html'),
      );
      return await this.canAutoPrint(resolved.format_type);
    } catch {
      return false;
    }
  }

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

    const requestedCopies =
      overrides?.copies ?? configured?.copies ?? legacy.copies ?? fallback.copies;
    const copies =
      typeof requestedCopies === 'number' && Number.isFinite(requestedCopies)
        ? Math.max(0, Math.trunc(requestedCopies))
        : 1;

    const requestedMargin =
      overrides?.marginMm ?? configured?.margin_mm ?? fallback.margin_mm;
    const geometry = resolvePrintGeometry({
      format,
      margin_mm:
        typeof requestedMargin === 'number' && Number.isFinite(requestedMargin)
          ? requestedMargin
          : null,
      printable_width_mm:
        overrides?.printableWidthMm ?? configured?.printable_width_mm ?? null,
    });
    const { margins } = geometry;

    return {
      document,
      format,
      pageSize: geometry.page_size,
      paperWidthMm: geometry.paper_width_mm,
      get widthMm(): number {
        return geometry.paper_width_mm;
      },
      contentWidthMm: geometry.content_width_mm,
      printableWidthMm: geometry.printable_width_mm,
      margins,
      isRoll: geometry.is_roll,
      marginMm: Math.max(
        margins.top,
        margins.right,
        margins.bottom,
        margins.left,
      ),
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
    const { top, right, bottom, left } = config.margins;
    const margin = `${top}mm ${right}mm ${bottom}mm ${left}mm`;
    const content = `${config.contentWidthMm}mm`;

    return `
      <html>
        <head>
          <meta charset="utf-8">
          <title>${opts?.title ?? ''}</title>
          <style>
            /* Without an explicit @page size the driver falls back to its own
               default paper and centres an 80 mm ticket on a letter sheet. */
            @page { size: ${config.pageSize}; margin: ${margin}; }
            html, body { margin: 0; padding: 0; }
            .vx-print-root { width: ${content}; max-width: ${content}; margin: 0 auto; box-sizing: border-box; overflow-wrap: anywhere; }
            ${BASE_GUARD_CSS}
            @media print { html, body { background: #fff; } }
            ${opts?.styles ?? ''}
          </style>
        </head>
        <body><div class="vx-print-root">${bodyHtml}</div></body>
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
   * C.5 (R-5) — el `fallbackRequest` vive solo para papeles SIN dinero
   * (tiquete de despacho): ningún emisor de dinero lo pasa; si el gateway
   * falla, se retorna `null` y el caller muestra el error. Sin fallback
   * silencioso.
   */
  async printViaGateway(params: {
    formatType: PrintFormatType;
    documentId: number | string;
    title?: string;
    trigger?: PrintTrigger;
    fallbackRequest?: PrintRequest;
  }): Promise<PrintResult | null> {
    if (params.trigger === 'automatic' && !(await this.canAutoPrint(params.formatType))) {
      return {
        documents: 0,
        pages: 0,
        copies: 0,
        format: params.formatType as unknown as PrintFormat,
      };
    }

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
        const copies = this.normalizeGatewayCopies(response.copies);
        await this.sendToPrinter(this.prepareGatewayHtml(response.html, copies));
        return {
          documents: 1,
          pages: copies,
          copies,
          format: requestedFormat,
        };
      }
    } catch (err) {
      if (this.isForbiddenError(err)) {
        // An inactive format is a policy decision, not a gateway outage.
        // Never bypass it by rendering a local fallback, even for manual jobs.
        return null;
      }
      console.warn(
        `[DocumentPrintService] Error en Print Gateway para ${params.formatType}, aplicando fallback local:`,
        err,
      );
    }

    // Fallback a renderizado local en el navegador
    if (params.formatType === 'dispatch_ticket' && params.fallbackRequest) {
      return this.print({
        ...params.fallbackRequest,
        trigger: params.trigger ?? 'explicit',
      });
    }

    return null;
  }

  /**
   * Prints several documents of ONE gateway format in a single print dialog.
   *
   * Each document is rendered by the Print Gateway with the merchant's
   * configured format (same `/render` call as `printViaGateway`), in series.
   * The first rendered document provides the `<head>` (styles, `@page`); the
   * bodies of all of them are laid out with `composeBlocks`, so every document
   * (and every configured copy) starts on a new sheet.
   *
   * No local fallback: a document that fails to render is reported in
   * `failedIds` and the rest still print. An inactive format (403) aborts the
   * whole batch and returns `null`, like `printViaGateway`.
   */
  async printGatewayBatch(params: {
    formatType: PrintFormatType;
    documentIds: readonly (number | string)[];
    title?: string;
  }): Promise<{ printedIds: (number | string)[]; failedIds: (number | string)[] } | null> {
    const printedIds: (number | string)[] = [];
    const failedIds: (number | string)[] = [];
    const blocks: string[] = [];
    let shell: string | null = null;

    for (const documentId of params.documentIds) {
      try {
        const response = await firstValueFrom(
          this.gatewayClient.renderDocument(params.formatType, documentId, 'html'),
        );
        const html = response?.html;
        const parts = html ? this.splitGatewayBody(html) : null;
        if (!html || !parts) {
          failedIds.push(documentId);
          continue;
        }
        shell ??= html;
        const copies = this.normalizeGatewayCopies(response.copies);
        for (let copy = 0; copy < copies; copy++) blocks.push(parts.content);
        printedIds.push(documentId);
      } catch (err) {
        if (this.isForbiddenError(err)) return null;
        console.warn(
          `[DocumentPrintService] Print Gateway no renderizó ${params.formatType} #${documentId}:`,
          err,
        );
        failedIds.push(documentId);
      }
    }

    if (!shell || blocks.length === 0) {
      return { printedIds: [], failedIds };
    }

    const parts = this.splitGatewayBody(shell)!;
    const combined = shell.replace(
      parts.body,
      () => `${parts.opening}${this.composeBlocks(blocks, 1)}${parts.closing}`,
    );
    await this.sendToPrinter(this.withGatewayPrintGuard(combined));
    return { printedIds, failedIds };
  }

  /** Splits a gateway HTML document into its `<body>` tag pair and content. */
  private splitGatewayBody(
    documentHtml: string,
  ): { body: string; opening: string; content: string; closing: string } | null {
    const body = documentHtml.match(/<body\b[^>]*>[\s\S]*?<\/body\s*>/i)?.[0];
    if (!body) return null;
    const opening = body.match(/^<body\b[^>]*>/i)?.[0];
    const closing = body.match(/<\/body\s*>$/i)?.[0];
    if (!opening || !closing) return null;
    return {
      body,
      opening,
      content: body.slice(opening.length, body.length - closing.length),
      closing,
    };
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

    if (params.trigger === 'automatic' && !(await this.canAutoPrint(resolved.format_type))) {
      return {
        documents: 0,
        pages: 0,
        copies: 0,
        format: resolved.format_type as unknown as PrintFormat,
      };
    }

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

    // Tienda FE-capaz sin factura emitida: el gate devuelve el ticket como
    // salida honesta (`fe_pending_emission`). Rotularlo evita que el cliente
    // lo confunda con la factura electrónica que viene después.
    if (resolved.reason === 'fe_pending_emission') {
      response.html = this.withPendingFeNotice(response.html);
    }

    const requestedFormat = resolved.format_type as unknown as PrintFormat;
    const copies = this.normalizeGatewayCopies(response.copies);
    await this.sendToPrinter(this.prepareGatewayHtml(response.html, copies));
    return {
      documents: 1,
      pages: copies,
      copies,
      format: requestedFormat,
    };
  }

  private isForbiddenError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { status?: unknown; error?: { status?: unknown } };
    return candidate.status === 403 || candidate.error?.status === 403;
  }

  /**
   * Imprime un documento HTML COMPLETO ya compuesto por el llamador —
   * `<html>`, `<head>`, su propio `@page` y su propio `<body>`.
   *
   * A diferencia de `print()`, aquí el llamador decide el papel: se usa cuando
   * el documento NO es un recibo configurable por `receipts.printing` sino una
   * pieza con geometría propia (un cartel A4 de QR de mesa, por ejemplo).
   *
   * El valor de este seam es heredar el motor correcto: la espera a que el
   * documento parsee y a que CADA imagen haga fetch + decode antes de abrir el
   * diálogo. Llamar `print()` justo después de `doc.close()` —lo que hacen los
   * emisores no migrados— dispara la impresión antes de que el logo remoto
   * (S3) haya llegado: la vista previa en pantalla SÍ lo muestra porque el
   * iframe vive lo suficiente, pero el papel sale sin él.
   */
  async printHtmlDocument(documentHtml: string): Promise<void> {
    await this.sendToPrinter(documentHtml);
  }

  /**
   * Imprime directamente un HTML completo compilado por el Print Gateway (ej: preview o render directo)
   */
  async printGatewayHtml(documentHtml: string, copies = 1): Promise<void> {
    const normalizedCopies = this.normalizeGatewayCopies(copies);
    await this.sendToPrinter(this.prepareGatewayHtml(documentHtml, normalizedCopies));
  }

  /**
   * Inserta un rótulo de copia no fiscal al inicio del `<body>`. Estilos
   * inline a propósito: este HTML viaja a un iframe de impresión sin las
   * hojas del Hub, así que ninguna clase externa aplicaría.
   */
  private withPendingFeNotice(documentHtml: string): string {
    const notice =
      '<div style="border:1.5px dashed #000;text-align:center;font-family:Arial,sans-serif;' +
      'font-size:11px;font-weight:bold;padding:6px;margin:0 0 8px;box-sizing:border-box;max-width:100%;overflow-wrap:anywhere;">' +
      'COPIA INFORMATIVA — NO ES FACTURA ELECTRÓNICA</div>';
    if (/<body[^>]*>/i.test(documentHtml)) {
      return documentHtml.replace(/<body[^>]*>/i, (m) => `${m}${notice}`);
    }
    return `${notice}${documentHtml}`;
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
      // Rechaza en vez de resolver en silencio: no se envió nada a la
      // impresora, y quien cuenta lo enviado (la impresión por lote) lo daría
      // por impreso.
      iframe.remove();
      throw new Error('No se pudo preparar el documento de impresión.');
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
