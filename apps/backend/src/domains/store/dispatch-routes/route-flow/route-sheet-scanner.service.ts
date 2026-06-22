import { Injectable, Logger } from '@nestjs/common';
import { dispatch_route_stop_result_enum } from '@prisma/client';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { RouteFlowService } from './route-flow.service';
import { DispatchRoutesService } from '../dispatch-routes.service';
import { SettleStopDto } from '../dto';
import {
  ConfirmRouteSheetDto,
  RouteSheetMatchResult,
  RouteSheetMatchedStop,
  RouteSheetScanResult,
  RouteSheetScanStop,
} from './dto/scan-route-sheet.dto';
import sharp = require('sharp');

/**
 * Route-sheet AI scanner.
 *
 * 1:1 calque of `InvoiceScannerService` for dispatch route sheets:
 *   /scan    → preprocess + AIEngine.run('route_sheet_ocr') + normalize (no persist)
 *   /match   → resolve each extracted row to a real stop (no persist)
 *   /confirm → settle confirmed stops via RouteFlowService.settleStop +
 *              persist the PDF (S3 KEY) and scan metadata on the route.
 *
 * All Prisma access goes through `StorePrismaService` (store-scoped). Settlement
 * is NOT reimplemented — it is delegated to `RouteFlowService.settleStop`, which
 * owns the cash/AR/withholding/refund event fan-out.
 */
@Injectable()
export class RouteSheetScannerService {
  private readonly logger = new Logger(RouteSheetScannerService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
    private readonly routeFlow: RouteFlowService,
    private readonly dispatchRoutes: DispatchRoutesService,
    private readonly s3Service: S3Service,
  ) {}

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
   * `RouteSheetScanResult`. Validates the file, preprocesses (sharp resize for
   * images, raw passthrough for PDFs), sends it as an `image_url` data-uri to
   * the `route_sheet_ocr` vision app, and normalizes the JSON. Does NOT persist.
   */
  async scanRouteSheet(
    routeId: number,
    file: Express.Multer.File,
  ): Promise<RouteSheetScanResult> {
    this.assertValidFile(file);

    const { base64, mimeType } = await this.preprocessImage(file);
    const dataUri = `data:${mimeType};base64,${base64}`;

    this.logger.debug(`[RouteSheetScan] DataURI length: ${dataUri.length} chars`);

    const documentMessage: AIMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract the per-stop deliveries and cash collection from this hand-filled dispatch route sheet. Return ONLY the JSON object matching the schema defined in your system instructions.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    this.logger.debug(`[RouteSheetScan] Sending to AI engine...`);
    const response = await this.aiEngine.run('route_sheet_ocr', {}, [
      documentMessage,
    ]);

    this.logger.debug(
      `[RouteSheetScan] AI response: success=${response.success}, contentLength=${response.content?.length ?? 0}, model=${response.model}, error=${response.error}`,
    );

    if (!response.success || !response.content) {
      this.logger.error(`AI route-sheet extraction failed: ${response.error}`);
      throw new VendixHttpException(ErrorCodes.RTSCAN_AI_FAIL);
    }

    try {
      let content = response.content.trim();
      // Strip markdown code fences if present
      if (content.startsWith('```')) {
        content = content
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(content);
      return this.normalizeScanResponse(parsed);
    } catch (err) {
      if (err instanceof VendixHttpException) throw err;
      this.logger.error(
        `Failed to parse AI route-sheet response: ${response.content}`,
      );
      throw new VendixHttpException(ErrorCodes.RTSCAN_PARSE_FAIL);
    }
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
          `Fila parada #${extracted.stop_sequence}${extracted.remision_number ? ` (rem ${extracted.remision_number})` : ''} no mapea a ninguna parada de la planilla.`,
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
        dispatch_note: { select: { grand_total: true } },
      },
    });
    const stopById = new Map<
      number,
      { net: number; status: string }
    >(
      stops.map((s) => [
        s.id,
        {
          net: Number(s.dispatch_note?.grand_total ?? 0),
          status: s.status as string,
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
    const skipped: Array<{ stop_id: number; reason: string }> = [];
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

      const settleDto = new SettleStopDto();
      settleDto.result =
        (decision.result as dispatch_route_stop_result_enum) ??
        this.deriveResult(
          decision.delivered,
          Number(decision.collected_amount ?? 0),
          current.net,
        );
      settleDto.collected_amount = Number(decision.collected_amount ?? 0);
      settleDto.payment_method = decision.payment_method;
      settleDto.withholding_breakdown = decision.withholding_breakdown;
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

  private assertValidFile(file?: Express.Multer.File): void {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.RTSCAN_NO_FILE);
    }
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new VendixHttpException(ErrorCodes.RTSCAN_INVALID_FILE);
    }
  }

  /**
   * Derive the settle result from the delivery flag + collected amount. Mirrors
   * the validation in `RouteFlowService.settleStop`:
   *   delivered + covers net  → 'delivered'
   *   delivered + partial pay → 'partial'
   *   not delivered           → 'rejected'
   */
  private deriveResult(
    delivered: boolean,
    collected: number,
    net: number,
  ): dispatch_route_stop_result_enum {
    if (!delivered) return 'rejected';
    if (net > 0 && collected < net) return 'partial';
    return 'delivered';
  }

  private normalizeRemision(value: string): string {
    return value.replace(/\s+/g, '').toLowerCase();
  }

  /**
   * Try to optimize images via sharp; on failure (e.g. PDFs) fall back to the
   * raw buffer with its original mimetype, so the vision model processes PDFs
   * natively. Identical strategy to invoice/rut scanners.
   */
  private async preprocessImage(
    file: Express.Multer.File,
  ): Promise<{ base64: string; mimeType: string }> {
    const MAX_DIMENSION = 1536;
    const JPEG_QUALITY = 85;

    try {
      const metadata = await sharp(file.buffer).metadata();
      const needsResize =
        (metadata.width && metadata.width > MAX_DIMENSION) ||
        (metadata.height && metadata.height > MAX_DIMENSION);

      let pipeline = sharp(file.buffer);

      if (needsResize) {
        pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      const processedBuffer = await pipeline
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();

      return {
        base64: processedBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      };
    } catch (err) {
      this.logger.warn(
        `[RouteSheetScan] Image preprocessing failed, using raw: ${err.message}`,
      );
      return {
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
      };
    }
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
