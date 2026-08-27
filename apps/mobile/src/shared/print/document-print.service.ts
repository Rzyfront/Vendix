import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { apiPost } from '@/core/api/http';
import { useAuthStore } from '@/core/store/auth.store';
import type { ReceiptsSettings } from '@/features/store/types/settings.types';

import {
  PRINT_DEFAULTS,
  PRINT_PAGE_GEOMETRY,
  mmToPoints,
  type PrintDocument,
  type PrintFormat,
} from './print-formats';

/**
 * Why the job is being sent to the printer. It is NOT a presentation decision:
 * it is what makes `copies: 0` mean two different, both-correct things.
 *
 * - `explicit`: somebody pressed "Imprimir". They want paper, so a configured
 *   `0` is clamped to one copy — refusing to print after a tap reads as a
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
  /** Renders a format the merchant has NOT saved yet (settings preview only). */
  format?: PrintFormat;
  /**
   * Copy count taken from a source more current than the session snapshot.
   * `receipts` reaches the app through the persisted `vendix_auth_state`, which
   * only rehydrates on re-login, so a caller that read the live row (e.g. the
   * settings screen's own query) passes the canonical number here.
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
  /** Fixed sheet height in millimetres, or `null` on a continuous roll. */
  heightMm: number | null;
  /**
   * Continuous roll (`size: <w>mm auto`): the sheet grows with the content, so
   * one block is always exactly one page. Fixed-height formats can fragment a
   * long body onto a second sheet.
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
   * one is repeated `copies` times contiguously (doc1 ×C, doc2 ×C, …).
   */
  body: string | readonly string[];
  /** Title of the generated document. */
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
  /**
   * Receipts block to resolve the paper from. Defaults to the persisted auth
   * snapshot (`store_settings.receipts`), which is what every POS surface has
   * at hand; a screen holding a fresher copy passes it here.
   */
  receipts?: ReceiptsSettings | null;
}

export interface PrintResult {
  /** Bodies actually laid out. 0 means nothing reached the printer. */
  documents: number;
  /** Sheets sent (`documents × copies`); exact only when `isRoll`. */
  pages: number;
  /** Copies effectively used, after the `PrintTrigger` clamp. */
  copies: number;
  /** Format the job was rendered for. */
  format: PrintFormat;
}

export interface ShareResult extends PrintResult {
  /** `true` when the share sheet opened; `false` when it is unavailable. */
  shared: boolean;
  /** Local URI of the generated PDF, or `null` when nothing was rendered. */
  uri: string | null;
}

/**
 * What the backend `/store/print-formats/render` endpoint hands back: the
 * rendered HTML and the paper geometry the caller should hand back to
 * expo-print. The renderer already resolved copies and width_mm against
 * the store configuration, so the mobile side does not consult `receipts`
 * for documents that came back this way.
 */
export interface RenderDocumentResult {
  /** Fully-rendered HTML document, including the `<html>`/`<head>` envelope. */
  html: string;
  /** `true` when the page box is a continuous roll. */
  is_roll: boolean;
  /** Printable width in millimetres. */
  width_mm: number;
  /** Copies the merchant configured for this format. 0 = silent no-op. */
  copies: number;
}

/**
 * Options for `printHtml`: handed the rendered document the caller already
 * has (e.g. from `renderDocument`) so the same pipe produces the actual
 * sheet without the service knowing the source.
 */
export interface PrintHtmlOptions {
  widthMm: number;
  isRoll: boolean;
  copies?: number;
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
 * `receipts` from the persisted auth snapshot. Same source the web reads
 * through `StoreSettingsFacade.receipts()` — `store_settings` is stored flat
 * at the root of `vendix_auth_state`, with one key per settings section.
 */
function receiptsFromSession(): ReceiptsSettings | null {
  const settings = useAuthStore.getState().store_settings as
    | { receipts?: ReceiptsSettings }
    | null
    | undefined;
  return settings?.receipts ?? null;
}

/**
 * Resolves the paper for a document without printing it.
 *
 * Precedence — the SAME cascade the web `DocumentPrintService` applies, so a
 * ticket printed from the phone lands on the same paper as the one printed
 * from the desktop: explicit override → `receipts.printing[document]` → the
 * legacy single-format mirror (`pos_ticket_format` and friends) →
 * `PRINT_DEFAULTS`. An unknown format falls back to the document's default
 * rather than reaching `@page` as a value the renderer will silently ignore.
 */
export function resolvePrintConfig(
  document: PrintDocument,
  overrides?: PrintOverrides,
  receiptsOverride?: ReceiptsSettings | null,
): ResolvedPrintConfig {
  const receipts = receiptsOverride ?? receiptsFromSession();
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
    heightMm: geometry.height_mm,
    isRoll: geometry.is_roll,
    marginMm,
    copies,
  };
}

/**
 * The full print document around one or more bodies, ready to hand to
 * expo-print or to show as a preview.
 *
 * Exposed because a preview must review the EXACT document the printer
 * receives — `@page size` and `@media print` rules included.
 */
export function buildDocumentHtml(
  config: ResolvedPrintConfig,
  bodyHtml: string,
  opts?: { title?: string; styles?: string },
): string {
  const margin = config.marginMm > 0 ? `${config.marginMm}mm` : '0';
  // The WebView expo-print renders into has no paper of its own, so the body
  // has to be constrained to the printable width or an 80 mm ticket lays itself
  // out at the viewport width and comes out with 6 pt type.
  const printableMm = Math.max(0, config.widthMm - config.marginMm * 2);

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=${config.widthMm}mm, initial-scale=1" />
    <title>${opts?.title ?? 'Documento'}</title>
    <style>
      /* Without an explicit @page size the driver falls back to its own
         default paper and centres an 80 mm ticket on a letter sheet. */
      @page { size: ${config.pageSize}; margin: ${margin}; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body { width: ${printableMm}mm; }
      * { box-sizing: border-box; }
      @media print { html, body { background: #fff; } }
      ${opts?.styles ?? ''}
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

/**
 * Lays bodies and their copies out as page blocks.
 *
 * Neither expo-print nor a browser exposes a copy count to the renderer, so
 * extra copies are extra pages. Every block but the very first opens a new
 * sheet — the same rule for the second copy of one document and for the next
 * document of a batch.
 */
function composeBlocks(bodies: readonly string[], copies: number): string {
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

interface PreparedJob {
  config: ResolvedPrintConfig;
  html: string;
  result: PrintResult;
  /** Page box for expo-print, in points. `undefined` height = continuous roll. */
  pageBox: { width: number; height?: number };
}

/**
 * Resolves the paper, clamps the copies and lays the bodies out. Returns
 * `null` when the job prints nothing (empty batch, or `copies: 0` honoured on
 * an automatic trigger).
 */
function prepare(request: PrintRequest): PreparedJob | null {
  const config = resolvePrintConfig(
    request.document,
    request.overrides,
    request.receipts,
  );
  const bodies =
    typeof request.body === 'string' ? [request.body] : request.body;

  const copies =
    request.trigger === 'automatic'
      ? config.copies
      : Math.max(1, config.copies);

  if (!bodies.length || copies === 0) return null;

  return {
    config,
    html: buildDocumentHtml(config, composeBlocks(bodies, copies), {
      title: request.title,
      styles: request.styles,
    }),
    result: {
      documents: bodies.length,
      pages: bodies.length * copies,
      copies,
      format: config.format,
    },
    pageBox: {
      width: mmToPoints(config.widthMm),
      // A roll grows with its content; imposing a height would cut the ticket
      // at an arbitrary line instead of letting the sheet run.
      ...(config.heightMm !== null
        ? { height: mmToPoints(config.heightMm) }
        : {}),
    },
  };
}

const EMPTY_RESULT = (format: PrintFormat): PrintResult => ({
  documents: 0,
  pages: 0,
  copies: 0,
  format,
});

/**
 * The single point of entry for printing anything from the mobile app.
 *
 * A caller says WHICH document it wants printed and hands over its body. It
 * decides nothing about the paper: format, `@page`, margin and copies all come
 * from `receipts.printing[document]`, per store and per document type, with the
 * legacy mirrors and `PRINT_DEFAULTS` behind them — the exact cascade the web
 * `DocumentPrintService` applies.
 */
export const DocumentPrintService = {
  resolveConfig: resolvePrintConfig,
  buildDocumentHtml,

  /**
   * Asks the backend to render a document for `formatType` (e.g. a dispatch
   * ticket) and returns the body HTML plus the paper geometry the backend
   * resolved against the store's print configuration. The mobile then hands
   * that exact HTML to `printHtml` so a ticket printed from the phone lands
   * on the same paper as one printed from the desktop.
   *
   * Lives on the service rather than on the calling feature so the
   * dispatch/print-dispatch-ticket flow does not have to know the URL.
   */
  async renderDocument(opts: {
    formatType: string;
    documentId: number | string;
    engine?: 'html' | 'pdf';
  }): Promise<RenderDocumentResult> {
    return apiPost<RenderDocumentResult>('/store/print-formats/render', {
      format_type: opts.formatType,
      document_id: opts.documentId,
      engine: opts.engine ?? 'html',
    });
  },

  /**
   * Prints HTML the caller already has, sized to the paper the backend
   * resolved. The `copies` from the caller win over `opts.copies` because
   * `renderDocument` already validated the configured value.
   */
  async printHtml(
    html: string,
    opts: PrintHtmlOptions,
  ): Promise<void> {
    const pageBox: { width: number; height?: number } = {
      width: mmToPoints(opts.widthMm),
    };
    if (!opts.isRoll) {
      /*
       * A fixed sheet (A4, half letter) needs a height too. The backend's
       * render endpoint returns width_mm and a roll flag, never height_mm
       * — fall back to the format's own height from the local
       * PRINT_PAGE_GEOMETRY lookup.
       */
      const formatKey = (
        Object.keys(PRINT_PAGE_GEOMETRY) as Array<keyof typeof PRINT_PAGE_GEOMETRY>
      ).find((k) => PRINT_PAGE_GEOMETRY[k].width_mm === opts.widthMm);
      const geometry = formatKey ? PRINT_PAGE_GEOMETRY[formatKey] : undefined;
      if (geometry && geometry.height_mm !== null) {
        pageBox.height = mmToPoints(geometry.height_mm);
      }
    }
    await Print.printAsync({ html, ...pageBox });
  },

  /** Resolves the paper, lays the bodies out and opens the print dialog. */
  async print(request: PrintRequest): Promise<PrintResult> {
    const job = prepare(request);
    if (!job) {
      return EMPTY_RESULT(
        resolvePrintConfig(request.document, request.overrides, request.receipts)
          .format,
      );
    }

    await Print.printAsync({ html: job.html, ...job.pageBox });
    return job.result;
  },

  /**
   * Renders the same document to a PDF and hands it to the OS share sheet.
   *
   * A PDF and not the raw HTML: `Sharing.shareAsync('data:text/html,…')` — what
   * the POS did before — is not a file URI, so on device it either fails or
   * shares an unopenable blob. Going through `printToFileAsync` also means the
   * shared file carries the SAME page box as the printed one.
   */
  async share(
    request: PrintRequest & { dialogTitle?: string },
  ): Promise<ShareResult> {
    const job = prepare(request);
    if (!job) {
      const format = resolvePrintConfig(
        request.document,
        request.overrides,
        request.receipts,
      ).format;
      return { ...EMPTY_RESULT(format), shared: false, uri: null };
    }

    const { uri } = await Print.printToFileAsync({
      html: job.html,
      ...job.pageBox,
    });

    if (!(await Sharing.isAvailableAsync())) {
      // No share sheet on this platform (web): fall back to the print dialog so
      // the action still produces the document instead of failing silently.
      await Print.printAsync({ html: job.html, ...job.pageBox });
      return { ...job.result, shared: false, uri };
    }

    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: request.dialogTitle ?? request.title ?? 'Compartir documento',
    });

    return { ...job.result, shared: true, uri };
  },
};
