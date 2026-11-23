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
import { RouteFlowService } from './route-flow.service';
import { DispatchRoutesService } from '../dispatch-routes.service';
import { SettleStopDto } from '../dto';
import { deriveStopIsPrepaid } from '../utils/route-stop-calc';
import {
  ConfirmRouteSheetDto,
  RouteSheetMatchResult,
  RouteSheetMatchedStop,
  RouteSheetScanResult,
  RouteSheetScanStop,
} from './dto/scan-route-sheet.dto';

/**
 * Route-sheet AI scanner.
 *
 * 1:1 calque of `InvoiceScannerService` for dispatch route sheets:
 *   /scan    → shared page reader (ai-ingest) with 'route_sheet_ocr' + normalize (no persist)
 *   /match   → resolve each extracted row to a real stop (no persist)
 *   /confirm → settle confirmed stops via RouteFlowService.settleStop +
 *              persist the PDF (S3 KEY) and scan metadata on the route.
 *
 * All Prisma access goes through `StorePrismaService` (store-scoped). Settlement
 * is NOT reimplemented — it is delegated to `RouteFlowService.settleStop`, which
 * owns the cash/AR/withholding/refund event fan-out.
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
          select: { dispatch_number: true, grand_total: true },
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
            }
          : null,
        suggested_result: this.deriveResult(
          extracted.delivered,
          Number(extracted.collected_amount ?? 0),
          Number(resolved?.dispatch_note?.grand_total ?? 0),
        ),
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
   * Settle the human-confirmed stops in batch (delegating to
   * `RouteFlowService.settleStop`), upload the route-sheet PDF to S3 (storing
   * the KEY, never a presigned URL), and persist the scan metadata on the route.
   */
  async confirmAndSettle(
    routeId: number,
    file: Express.Multer.File,
    dto: ConfirmRouteSheetDto,
  ) {
    const store_id = this.getStoreId();
    this.assertValidFile(file);

    // Validate the route belongs to the store, and resolve net totals per stop
    // (needed to derive the settle result when not explicitly provided).
    const route = await this.prisma.dispatch_routes.findFirst({
      where: { id: routeId, store_id },
      select: { id: true },
    });
    if (!route) {
      throw new VendixHttpException(ErrorCodes.RTSCAN_MATCH_001);
    }

    // Read every stop of the route once: net total (for result derivation) and
    // CURRENT status (for the idempotent reconciliation). We index by the stop's
    // own id so a decision pointing at a stop NOT in this route is detected.
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
            // `is_prepaid` congelado de la parada). El escáner liquida en lote
            // por `settleStop`, así que debe juzgar la cobertura del cobro con
            // el mismo criterio que él: una remisión ya pagada no tiene neto
            // que cubrir y no puede caer en "cobro corto".
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

    // 1. Settle each confirmed stop via the existing settleStop flow, with
    //    per-stop reconciliation. One failing stop must NOT abort the batch.
    const settled: Array<{ stop_id: number; result: string }> = [];
    // `collected_amount` / `net` solo viajan con
    // `reason: 'short_payment_requires_decision'`, para que el operador vea
    // cuánto falta sin tener que reabrir la parada.
    const skipped: Array<{
      stop_id: number;
      reason: string;
      collected_amount?: number;
      net?: number;
    }> = [];
    const errors: Array<{ stop_id: number; message: string }> = [];

    for (const decision of dto.stops) {
      const current = stopById.get(decision.stop_id);

      // Stop is not part of this route / store — reconcile as skipped.
      if (!current) {
        skipped.push({ stop_id: decision.stop_id, reason: 'not_in_route' });
        continue;
      }

      // Already in a terminal state — do NOT call settleStop (it would 400).
      // This is the reconciliation that makes re-confirming a sheet idempotent.
      if (TERMINAL_STATUSES.has(current.status)) {
        skipped.push({ stop_id: decision.stop_id, reason: 'already_settled' });
        continue;
      }

      const collected_amount = Number(decision.collected_amount ?? 0);
      const resolvedResult =
        (decision.result as dispatch_route_stop_result_enum) ??
        this.deriveResult(
          decision.delivered,
          collected_amount,
          current.net,
          current.is_prepaid,
        );

      // Entregada con cobro menor al neto: no hay resultado derivable. En ruta el
      // pago es total o no hay entrega, así que ni liquidamos ni elegimos por el
      // operador — reversar inventario ya despachado (`rejected`) o asumir el
      // faltante (`delivered`) es una decisión de caja suya. La parada queda sin
      // tocar y el batch sigue con las demás.
      if (resolvedResult == null) {
        skipped.push({
          stop_id: decision.stop_id,
          reason: 'short_payment_requires_decision',
          collected_amount,
          net: current.net,
        });
        continue;
      }

      const settleDto = new SettleStopDto();
      settleDto.result = resolvedResult;
      settleDto.collected_amount = collected_amount;
      settleDto.payment_method = decision.payment_method;
      settleDto.withholding_breakdown = decision.withholding_breakdown;
      // Derive withholding_amount from the breakdown sum. settleStop reads
      // `dto.withholding_amount` (not the breakdown) for the withholding-agent
      // gate and requires it to equal the breakdown sum, so a scanner payload
      // that only carries the breakdown would otherwise 400 for a retenedor.
      const wb = decision.withholding_breakdown as
        | { retefuente?: number; reteiva?: number; reteica?: number }
        | undefined;
      if (wb) {
        settleDto.withholding_amount =
          Number(wb.retefuente || 0) +
          Number(wb.reteiva || 0) +
          Number(wb.reteica || 0);
      }
      settleDto.notes = decision.notes;

      // Wrap each settle so a single failure (e.g. validation 400) is collected
      // and the rest of the batch still runs.
      try {
        await this.routeFlow.settleStop(routeId, decision.stop_id, settleDto);
        settled.push({ stop_id: decision.stop_id, result: settleDto.result });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Error liquidando la parada';
        this.logger.warn(
          `[RouteSheetScan] settleStop failed for stop ${decision.stop_id}: ${message}`,
        );
        errors.push({ stop_id: decision.stop_id, message });
      }
    }

    // 2. Upload the route sheet to S3 (store the KEY, not a presigned URL).
    const s3Key = await this.s3Service.uploadFile(
      file.buffer,
      `dispatch-routes/planillas/${routeId}/${Date.now()}-${file.originalname}`,
      file.mimetype,
    );

    // 3. Persist scan metadata on the route (store-scoped via updateMany).
    await this.prisma.dispatch_routes.updateMany({
      where: { id: routeId, store_id },
      data: {
        planilla_pdf_key: s3Key,
        planilla_scanned_at: new Date(),
        scan_result: (dto.scan_result as any) ?? undefined,
        scan_confidence: dto.scan_result?.confidence ?? undefined,
        updated_at: new Date(),
      },
    });

    // 4. Re-read the route in its updated state (same canonical shape the rest
    //    of the flow returns: stops + reconciliation + derived is_prepaid) so
    //    the frontend can refresh the detail view without a second round-trip.
    const route_updated = await this.dispatchRoutes.findOne(routeId);

    this.logger.log(
      `[RouteSheetScan] Route #${routeId}: settled=${settled.length} skipped=${skipped.length} errors=${errors.length} + planilla persisted (${s3Key})`,
    );

    return {
      route_id: routeId,
      planilla_pdf_key: s3Key,
      settled,
      skipped,
      errors,
      route: route_updated,
    };
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
