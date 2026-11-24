import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { dispatch_route_stop_result_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { AiScanFile } from '@common/ai-scan-jobs/interfaces/ai-scan-job.interface';
import { AiScanHandlerRegistry } from '@common/ai-scan-jobs/ai-scan-handler.registry';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import type { AiJobProgress } from '@common/ai-scan-jobs/ai-job-monitor.service';
import { detectIngestFile, DetectedIngestFile } from '@common/ai-ingest/ingest-file.detector';
import {
  AiExtractionError,
  AiExtractionService,
  newIngestQuotaKey,
} from '@common/ai-ingest/extraction/ai-extraction.service';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import { readDocumentWithAi } from '@common/ai-ingest/documents/document-reader';
import {
  buildRouteSheetInstruction,
  mergeRouteSheetBatches,
  ROUTE_SHEET_MAX_BYTES,
  ROUTE_SHEET_PROFILE,
} from './route-sheet-ingest.profile';
import { AtomicStopItem, RouteFlowService } from './route-flow.service';
import { DispatchRoutesService } from '../dispatch-routes.service';
import { SettleStopDto } from '../dto';
import {
  derivePendingAmount,
  deriveStopIsPrepaid,
} from '../utils/route-stop-calc';
import {
  ConfirmRouteSheetDto,
  RouteSheetMatchResult,
  RouteSheetMatchedStop,
  RouteSheetScanResult,
  RouteSheetScanStop,
  RouteSheetStopResult,
  ROUTE_SHEET_MAX_AMOUNT,
} from './dto/scan-route-sheet.dto';

/**
 * Route-sheet AI scanner.
 *
 * 1:1 calque of `InvoiceScannerService` for dispatch route sheets:
 *   /scan    → shared page reader (ai-ingest) with 'route_sheet_ocr' + normalize (no persist)
 *   /match   → resolve each extracted row to a real stop (no persist)
 *   /confirm → settle / release the confirmed stops and persist the PDF
 *              (S3 KEY) + scan metadata, all in ONE transaction.
 *
 * All Prisma access goes through `StorePrismaService` (store-scoped). Settlement
 * is NOT reimplemented — it is delegated to
 * `RouteFlowService.settleStopsAtomically`, which reuses the validations and
 * writes of `settleStop` / `releaseStop` and owns the cash/AR/withholding/refund
 * event fan-out.
 */
@Injectable()
export class RouteSheetScannerService implements OnModuleInit {
  private readonly logger = new Logger(RouteSheetScannerService.name);

  constructor(
    private readonly extraction: AiExtractionService,
    private readonly prisma: StorePrismaService,
    private readonly routeFlow: RouteFlowService,
    private readonly dispatchRoutes: DispatchRoutesService,
    private readonly s3Service: S3Service,
    private readonly aiScanRegistry: AiScanHandlerRegistry,
    private readonly documentPages: DocumentPagesService,
  ) {}

  /** Registra el handler async `route_sheet` (cola generica `ai-scan`). */
  onModuleInit(): void {
    this.aiScanRegistry.register<RouteSheetScanResult>(
      'route_sheet',
      ({ files, params, reportProgress }) =>
        this.scanRouteSheetFromFiles(
          files,
          { route_id: Number(params?.route_id) },
          reportProgress,
        ),
    );
  }

  private getStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // /scan
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Scan a hand-filled route sheet (image or PDF) into a normalized
   * `RouteSheetScanResult`. Validates the file by its real type and reads it
   * through the shared ai-ingest page reader. Does NOT persist.
   */
  async scanRouteSheet(
    routeId: number,
    file: Express.Multer.File,
  ): Promise<RouteSheetScanResult> {
    this.assertValidFile(file);
    return this.scanRouteSheetFromFiles([this.toScanFile(file)], {
      route_id: routeId,
    });
  }

  /**
   * Nucleo del escaneo (buffer + mime, sin multer). Lo usan el endpoint
   * sincrono y el handler async `route_sheet` de la cola `ai-scan`.
   * `route_id` hoy no se usa en el escaneo (solo se propaga por contrato).
   */
  async scanRouteSheetFromFiles(
    files: AiScanFile[],
    _params: { route_id: number },
    reportProgress?: (progress: AiJobProgress) => Promise<void>,
  ): Promise<RouteSheetScanResult> {
    const file = files?.[0];
    const detected = this.assertValidScanFile(file);

    // ia-cargas F5a (#10): pages with native PDF text travel as text, scanned
    // pages and photos as images (EXIF-straightened, ≤1536 px). Never the raw
    // PDF. Up to 5 pages in ONE call; the answer is checked with a schema and
    // repaired once. A photo stays ONE image: strips could read a stop twice
    // in their overlap and settle its cash twice.
    let read;
    try {
      read = await readDocumentWithAi<Record<string, any>>({
        file: { buffer: file.buffer, originalName: file.originalName },
        mimeType: detected.mime,
        pages: this.documentPages,
        extraction: this.extraction,
        appKey: 'route_sheet_ocr',
        schema: ROUTE_SHEET_PROFILE.documentSchema,
        instruction: buildRouteSheetInstruction,
        limits: ROUTE_SHEET_PROFILE.limits,
        maxBytes: ROUTE_SHEET_MAX_BYTES,
        splitTallImages: false,
        // One unit of quota per scan, as the single call charged before.
        quotaKey: newIngestQuotaKey(),
        reportProgress,
        logLabel: 'RouteSheetScan',
      });
    } catch (err) {
      throw this.toScanError(err);
    }

    const result = this.normalizeScanResponse(mergeRouteSheetBatches(read.answers));
    return {
      ...result,
      ...(read.warnings.length ? { warnings: read.warnings } : {}),
      scan_source: {
        pages: read.pages,
        text_pages: read.textPages,
        batches: read.batches.length,
        ...(read.missingPages.length ? { missing_pages: read.missingPages } : {}),
      },
    };
  }

  /**
   * Keeps the scanner's error contract: an unusable model answer is still
   * `RTSCAN_PARSE_FAIL` and an AI failure `RTSCAN_AI_FAIL`. Document problems
   * keep their `AI_INGEST_*` code and credits / rate limit their
   * `AI_PROVIDER_*` one.
   */
  private toScanError(err: unknown): unknown {
    const error = err instanceof AiExtractionError ? err.toHttpException() : err;
    if (!(error instanceof VendixHttpException)) return error;
    if (error.errorCode === ErrorCodes.AI_INGEST_PARSE_FAIL.code) {
      this.logger.error('[RouteSheetScan] AI answer unusable after repair');
      return new VendixHttpException(ErrorCodes.RTSCAN_PARSE_FAIL);
    }
    if (error.errorCode === ErrorCodes.AI_REQUEST_001.code) {
      this.logger.error('[RouteSheetScan] AI route-sheet extraction failed');
      return new VendixHttpException(ErrorCodes.RTSCAN_AI_FAIL);
    }
    return error;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // /scan/match
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Resolve every extracted row to a real stop of the route, by
   * `remision_number` (dispatch_note.dispatch_number) first, then by
   * `stop_sequence`. Returns the proposal (actual vs extracted) WITHOUT
   * persisting. Rows that map to no stop are flagged (`match_method: 'none'`);
   * if NONE of the rows map, throws RTSCAN_MATCH_001.
   */
  async matchStops(
    routeId: number,
    scan: RouteSheetScanResult,
  ): Promise<RouteSheetMatchResult> {
    const store_id = this.getStoreId();

    // Confirm the route belongs to the store (scoped) and load its stops.
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id: routeId, store_id },
      select: { id: true },
    });
    if (!route) {
      throw new VendixHttpException(ErrorCodes.RTSCAN_MATCH_001);
    }

    const stops = await this.prisma.dispatch_route_stops.findMany({
      where: { route_id: routeId },
      select: {
        id: true,
        stop_sequence: true,
        status: true,
        result: true,
        collected_amount: true,
        dispatch_note: {
          select: {
            dispatch_number: true,
            grand_total: true,
            // Live payment signals: the review must know which stops are
            // already paid (never collected) and what is really owed.
            needs_collection: true,
            invoice: { select: { payment_date: true } },
            order: { select: { remaining_balance: true } },
          },
        },
      },
    });

    const byRemision = new Map<string, (typeof stops)[number]>();
    const bySequence = new Map<number, (typeof stops)[number]>();
    for (const s of stops) {
      if (s.dispatch_note?.dispatch_number) {
        byRemision.set(
          this.normalizeRemision(s.dispatch_note.dispatch_number),
          s,
        );
      }
      bySequence.set(s.stop_sequence, s);
    }

    const warnings: string[] = [];
    const matched: RouteSheetMatchedStop[] = [];
    let mappedCount = 0;

    for (const extracted of scan.stops) {
      let resolved: (typeof stops)[number] | undefined;
      let method: RouteSheetMatchedStop['match_method'] = 'none';

      if (extracted.remision_number) {
        resolved = byRemision.get(
          this.normalizeRemision(extracted.remision_number),
        );
        if (resolved) method = 'remision';
      }
      if (!resolved && extracted.stop_sequence != null) {
        resolved = bySequence.get(extracted.stop_sequence);
        if (resolved) method = 'sequence';
      }

      if (resolved) {
        mappedCount++;
      } else {
        warnings.push(
          `Fila parada #${extracted.stop_sequence}${extracted.remision_number ? ` (rem ${extracted.remision_number})` : ''} no mapea a ninguna parada de la ruta.`,
        );
      }

      matched.push({
        extracted,
        stop_id: resolved?.id ?? null,
        stop_sequence: resolved?.stop_sequence ?? null,
        remision_number: resolved?.dispatch_note?.dispatch_number ?? null,
        match_method: method,
        current: resolved
          ? {
              status: resolved.status,
              result: resolved.result ?? null,
              grand_total: Number(resolved.dispatch_note?.grand_total ?? 0),
              collected_amount: Number(resolved.collected_amount ?? 0),
              is_prepaid: deriveStopIsPrepaid(resolved),
              pending_amount: derivePendingAmount(resolved),
            }
          : null,
        suggested_result: this.deriveResult(
          extracted.delivered,
          Number(extracted.collected_amount ?? 0),
          Number(resolved?.dispatch_note?.grand_total ?? 0),
          resolved ? deriveStopIsPrepaid(resolved) : false,
        ),
        // Entrega y cobro van separados: la sugerencia es solo de ENTREGA.
        // Lo que la hoja no marca como entregado queda pendiente — rechazar o
        // liberar exige motivo y lo decide el operador, nunca la IA.
        suggested_outcome: extracted.delivered ? 'delivered' : 'pending',
      });
    }

    if (mappedCount === 0) {
      throw new VendixHttpException(ErrorCodes.RTSCAN_MATCH_001);
    }

    return { stops: matched, confidence: scan.confidence, warnings };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // /scan/confirm
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Settle the human-confirmed stops of a route sheet, ALL OR NOTHING.
   *
   *   1. Validate the whole payload before writing: the scan confidence is a
   *      0-100 percentage (stored as a 0-1 fraction), rejecting/releasing needs
   *      a reason, a prepaid or not-delivered stop carries no collection. Any
   *      problem → `RTSCAN_CONFIRM_INVALID` (400) and nothing is written.
   *   2. Upload the sheet to S3 (store the KEY, never a presigned URL).
   *   3. Settle / release every stop AND persist the scan metadata in ONE
   *      transaction (`RouteFlowService.settleStopsAtomically`, which reuses
   *      the same validations and writes as the manual settle/release). A
   *      failure in the middle rolls everything back.
   *
   * Already-terminal stops and stops outside the route are reconciled into
   * `skipped[]` (idempotent re-confirm). Stops whose outcome is not decided
   * (legacy `delivered: false` without `result`, or a delivered stop whose
   * cash does not cover the net) stay untouched in `skipped[]` too.
   * `errors[]` is kept for the response contract and is always empty: a
   * failing stop now aborts the whole confirm instead of half-applying it.
   */
  async confirmAndSettle(
    routeId: number,
    file: Express.Multer.File,
    dto: ConfirmRouteSheetDto,
  ) {
    const store_id = this.getStoreId();
    this.assertValidFile(file);

    // Out-of-range confidence → 400 here, never a P2020 inside the write.
    const scan_confidence = this.toScanConfidence(dto.scan_result?.confidence);

    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id: routeId, store_id },
      select: { id: true },
    });
    if (!route) {
      throw new VendixHttpException(ErrorCodes.RTSCAN_MATCH_001);
    }

    // Read every stop of the route once: net total (for result derivation),
    // DERIVED prepaid and CURRENT status (for the idempotent reconciliation).
    const stopIds = dto.stops.map((s) => s.stop_id);
    const stops = await this.prisma.dispatch_route_stops.findMany({
      where: { route_id: routeId, id: { in: stopIds } },
      select: {
        id: true,
        status: true,
        dispatch_note: {
          select: {
            grand_total: true,
            // Señales de pago vivas para DERIVAR el prepago (nunca el
            // `is_prepaid` congelado de la parada): una remisión ya pagada no
            // tiene neto que cubrir ni admite cobro.
            needs_collection: true,
            invoice: { select: { payment_date: true } },
            order: { select: { remaining_balance: true } },
          },
        },
      },
    });
    const stopById = new Map<
      number,
      { net: number; status: string; is_prepaid: boolean }
    >(
      stops.map((s) => [
        s.id,
        {
          net: Number(s.dispatch_note?.grand_total ?? 0),
          status: s.status as string,
          is_prepaid: deriveStopIsPrepaid(s),
        },
      ]),
    );

    // Terminal stop states are already settled — re-liquidating them throws a
    // 400 ("La parada ya está 'delivered'"). The scan/confirm batch must be
    // idempotent and reconcile against the live state, so we skip them.
    const TERMINAL_STATUSES = new Set(['delivered', 'rejected', 'released']);

    // `collected_amount` / `net` solo viajan con
    // `reason: 'short_payment_requires_decision'`, para que el operador vea
    // cuánto falta sin tener que reabrir la parada.
    const skipped: Array<{
      stop_id: number;
      reason: string;
      collected_amount?: number;
      net?: number;
    }> = [];
    const invalid: Array<{ stop_id: number; message: string }> = [];
    const items: AtomicStopItem[] = [];
    let batchCollected = 0;

    for (const decision of dto.stops) {
      const current = stopById.get(decision.stop_id);

      // Stop is not part of this route / store — reconcile as skipped.
      if (!current) {
        skipped.push({ stop_id: decision.stop_id, reason: 'not_in_route' });
        continue;
      }

      // Already in a terminal state — do NOT settle it again (it would 400).
      // This is the reconciliation that makes re-confirming a sheet idempotent.
      if (TERMINAL_STATUSES.has(current.status)) {
        skipped.push({ stop_id: decision.stop_id, reason: 'already_settled' });
        continue;
      }

      const collected_amount = Number(decision.collected_amount ?? 0);
      const breakdown = this.cleanBreakdown(decision.withholding_breakdown);
      const withholding = breakdown
        ? Number(breakdown.retefuente || 0) +
          Number(breakdown.reteiva || 0) +
          Number(breakdown.reteica || 0)
        : 0;

      let result: RouteSheetStopResult | null = decision.result ?? null;
      if (!result) {
        // Legacy payload (only the `delivered` flag). Not delivered is NOT a
        // silent rejection anymore: rejecting needs a reason, so the stop stays
        // untouched until the operator decides.
        if (decision.delivered !== true) {
          skipped.push({ stop_id: decision.stop_id, reason: 'outcome_required' });
          continue;
        }
        // Entregada con cobro menor al neto: no hay resultado derivable. En
        // ruta el pago es total o no hay entrega, así que ni liquidamos ni
        // elegimos por el operador — la parada queda sin tocar.
        if (
          this.deriveResult(true, collected_amount, current.net, current.is_prepaid) ==
          null
        ) {
          skipped.push({
            stop_id: decision.stop_id,
            reason: 'short_payment_requires_decision',
            collected_amount,
            net: current.net,
          });
          continue;
        }
        result = 'delivered';
      }

      const reason = decision.reason?.trim() || '';
      const hasCollection = collected_amount > 0 || withholding > 0;
      if (result !== 'delivered' && !reason) {
        invalid.push({
          stop_id: decision.stop_id,
          message: `Indica el motivo para ${result === 'rejected' ? 'rechazar' : 'liberar'} la parada.`,
        });
      }
      if (current.is_prepaid && hasCollection) {
        invalid.push({
          stop_id: decision.stop_id,
          message:
            'La orden ya está pagada: no se registra cobro sobre esta parada.',
        });
      } else if (result !== 'delivered' && hasCollection) {
        invalid.push({
          stop_id: decision.stop_id,
          message: `Una parada ${result === 'rejected' ? 'rechazada' : 'liberada'} no registra cobro.`,
        });
      }
      batchCollected += collected_amount + withholding;

      if (result === 'released') {
        items.push({ kind: 'release', stop_id: decision.stop_id, reason });
        continue;
      }

      const settleDto = new SettleStopDto();
      settleDto.result = result;
      settleDto.collected_amount = collected_amount;
      settleDto.payment_method =
        result === 'delivered'
          ? current.is_prepaid
            ? 'prepaid'
            : decision.payment_method
          : undefined;
      if (breakdown) {
        settleDto.withholding_breakdown = breakdown;
        // settleStop reads `withholding_amount` (not the breakdown) for the
        // withholding-agent gate and requires it to equal the breakdown sum.
        settleDto.withholding_amount = withholding;
      }
      settleDto.notes = decision.notes;
      if (result === 'rejected') settleDto.reason = reason;
      items.push({ kind: 'settle', stop_id: decision.stop_id, dto: settleDto });
    }

    // The route totals are Decimal(14,2) too: the sum must fit as well.
    if (batchCollected > ROUTE_SHEET_MAX_AMOUNT) {
      invalid.push({
        stop_id: 0,
        message: 'La suma de lo cobrado en la planilla excede el máximo permitido.',
      });
    }

    if (invalid.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.RTSCAN_CONFIRM_INVALID,
        `No se aplicó ningún cambio. ${invalid
          .map((e) => (e.stop_id ? `Parada #${e.stop_id}: ${e.message}` : e.message))
          .join(' | ')}`,
        { errors: invalid },
      );
    }

    // Upload the route sheet to S3 (store the KEY, not a presigned URL).
    const s3Key = await this.s3Service.uploadFile(
      file.buffer,
      `dispatch-routes/planillas/${routeId}/${Date.now()}-${file.originalname}`,
      file.mimetype,
    );

    let settled: Array<{ stop_id: number; result: string }>;
    try {
      settled = await this.routeFlow.settleStopsAtomically(
        routeId,
        items,
        async (tx) => {
          // Scan metadata, in the SAME transaction as the stops.
          await tx.dispatch_routes.updateMany({
            where: { id: routeId, store_id },
            data: {
              planilla_pdf_key: s3Key,
              planilla_scanned_at: new Date(),
              scan_result: (dto.scan_result as any) ?? undefined,
              scan_confidence,
              updated_at: new Date(),
            },
          });
        },
      );
    } catch (err) {
      // Nothing was applied: drop the orphan upload (best effort).
      await this.s3Service.deleteFile(s3Key).catch(() => undefined);
      throw err;
    }

    // Re-read the route in its updated state (same canonical shape the rest of
    // the flow returns) so the frontend can refresh without a second request.
    const route_updated = await this.dispatchRoutes.findOne(routeId);

    this.logger.log(
      `[RouteSheetScan] Route #${routeId}: settled=${settled.length} skipped=${skipped.length} + planilla persisted (${s3Key})`,
    );

    return {
      route_id: routeId,
      planilla_pdf_key: s3Key,
      settled,
      skipped,
      errors: [] as Array<{ stop_id: number; message: string }>,
      route: route_updated,
    };
  }

  /**
   * Scan confidence → `dispatch_routes.scan_confidence` (`Decimal(5,4)`, max
   * 9.9999). The model reports a 0-100 percentage (`route_sheet_ocr` prompt,
   * `normalizeScanResponse`), so it is stored as a 0-1 fraction. Writing the
   * raw percentage (e.g. 92) overflowed the column with Prisma P2020.
   * Absent → `undefined` (column untouched). Not a number or outside 0-100 →
   * `RTSCAN_CONFIRM_INVALID` before anything is written.
   */
  private toScanConfidence(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new VendixHttpException(
        ErrorCodes.RTSCAN_CONFIRM_INVALID,
        'No se aplicó ningún cambio: la confianza del escaneo debe estar entre 0 y 100.',
      );
    }
    return Math.round(pct * 100) / 10000;
  }

  /** Withholding breakdown as a plain object with only the positive lines. */
  private cleanBreakdown(
    breakdown?: { retefuente?: number; reteiva?: number; reteica?: number } | null,
  ): { retefuente?: number; reteiva?: number; reteica?: number } | undefined {
    if (!breakdown) return undefined;
    const out: { retefuente?: number; reteiva?: number; reteica?: number } = {};
    for (const key of ['retefuente', 'reteiva', 'reteica'] as const) {
      const v = Number(breakdown[key] || 0);
      if (v > 0) out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  /** Validacion previa (mime) reutilizable por el controller async antes de encolar. */
  assertValidFile(file?: Express.Multer.File): void {
    this.assertValidScanFile(file ? this.toScanFile(file) : undefined);
  }

  toScanFile(file: Express.Multer.File): AiScanFile {
    return {
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
      size: file.size,
    };
  }

  /**
   * File present, size and REAL type by signature (never the client mimetype):
   * a PDF or a photo (JPG, PNG, WebP). Anything else is `RTSCAN_INVALID_FILE`.
   */
  private assertValidScanFile(file?: AiScanFile): DetectedIngestFile {
    if (!file?.buffer?.length) {
      throw new VendixHttpException(ErrorCodes.RTSCAN_NO_FILE);
    }
    if (file.buffer.length > ROUTE_SHEET_MAX_BYTES) {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_INVALID_FILE,
        'La planilla debe pesar como máximo 15 MB.',
      );
    }
    const detected = detectIngestFile({
      buffer: file.buffer,
      originalName: file.originalName,
      mimeType: file.mimeType,
    });
    if (!detected || detected.kind === 'sheet') {
      throw new VendixHttpException(ErrorCodes.RTSCAN_INVALID_FILE);
    }
    return detected;
  }

  /**
   * Derive the settle result from the delivery flag + collected amount. Mirrors
   * the validation in `RouteFlowService.settleStop`:
   *   not delivered           → 'rejected'
   *   prepagada + delivered   → 'delivered' (sin cobertura que exigir)
   *   delivered + covers net  → 'delivered'
   *   delivered + short pay   → null (sin derivación — requiere decisión humana)
   *
   * Nunca devuelve `'partial'`: en ruta DSD el pago es total o no hay entrega, y
   * `settleStop` rechaza ese resultado con `DISPATCH_ROUTE_PARTIAL_DISABLED`.
   * Devolver `null` en el cobro corto es deliberado — ninguna de las dos salidas
   * automáticas es segura: `rejected` reversaría inventario de mercancía que ya
   * salió físicamente, y `delivered` moriría en el gate de monto de `settleStop`.
   *
   * La rama prepaga NO es una excepción al "pago total": es el mismo criterio
   * que `settleStop` (`!stopIsPrepaid && total_paid + withholding < net`). Sin
   * ella, una hoja de ruta con una remisión ya pagada salía siempre en
   * `skipped[]` como `short_payment_requires_decision` — el escáner pedía al
   * operador decidir sobre un faltante que no existe.
   */
  private deriveResult(
    delivered: boolean,
    collected: number,
    net: number,
    isPrepaid = false,
  ): dispatch_route_stop_result_enum | null {
    if (!delivered) return 'rejected';
    if (isPrepaid) return 'delivered';
    if (net > 0 && collected < net) return null;
    return 'delivered';
  }

  private normalizeRemision(value: string): string {
    return value.replace(/\s+/g, '').toLowerCase();
  }

  private normalizeScanResponse(parsed: any): RouteSheetScanResult {
    if (!parsed || !Array.isArray(parsed.stops)) {
      throw new VendixHttpException(ErrorCodes.RTSCAN_PARSE_FAIL);
    }

    // Defensive normalization: the prompt already maps to English codes, but
    // accept common Spanish hints in case the model returns them verbatim.
    const PAYMENT_METHODS = new Set(['cash', 'transfer', 'card', 'credit']);
    const PAYMENT_ALIASES: Record<string, string> = {
      efectivo: 'cash',
      transferencia: 'transfer',
      transf: 'transfer',
      tarjeta: 'card',
      credito: 'credit',
      crédito: 'credit',
      fiado: 'credit',
    };

    const stops: RouteSheetScanStop[] = parsed.stops.map(
      (row: any, index: number) => {
        const seqRaw = Number(row?.stop_sequence);
        const stop_sequence =
          Number.isFinite(seqRaw) && seqRaw > 0 ? Math.trunc(seqRaw) : index + 1;

        const collectedRaw = Number(row?.collected_amount);
        const collected_amount =
          row?.collected_amount == null || !Number.isFinite(collectedRaw)
            ? null
            : collectedRaw;

        const pmRaw = String(row?.payment_method ?? '')
          .trim()
          .toLowerCase();
        const pm = PAYMENT_ALIASES[pmRaw] ?? pmRaw;

        return {
          stop_sequence,
          remision_number:
            row?.remision_number != null &&
            String(row.remision_number).trim().length > 0
              ? String(row.remision_number).trim()
              : null,
          delivered: Boolean(row?.delivered),
          collected_amount,
          payment_method: PAYMENT_METHODS.has(pm) ? pm : null,
          notes:
            row?.notes != null && String(row.notes).trim().length > 0
              ? String(row.notes).trim()
              : null,
        };
      },
    );

    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(100, confidence));

    return { stops, confidence };
  }
}
