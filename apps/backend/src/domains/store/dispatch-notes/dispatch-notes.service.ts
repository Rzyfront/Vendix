import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../ai-engine/interfaces/ai-provider.interface';
import {
  CreateDispatchNoteDto,
  UpdateDispatchNoteDto,
  DispatchNoteQueryDto,
  CreateFromSalesOrderDto,
  CreateFromOrderDto,
  CreateFromOrdersBatchDto,
  CreateTransferDispatchDto,
  CreateReturnDispatchDto,
  CreatePurchaseReceiptDispatchDto,
} from './dto';
import {
  ScanReceiptResult,
  ScannedReceiptItem,
  RawReceiptScan,
  RawReceiptItem,
} from './dto/scan-receipt.dto';
import {
  dispatch_note_status_enum,
  dispatch_route_status_enum,
  dispatch_note_direction_enum,
  dispatch_note_subtype_enum,
  dispatch_note_reason_enum,
  Prisma,
} from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DispatchNumberGenerator } from './utils/dispatch-number-generator';
import { RouteNumberGenerator } from '../dispatch-routes/utils/route-number-generator';
import {
  buildStopsData,
  computeRouteTotals,
  resolveIsPrepaid,
  RouteStopNoteInput,
  RouteStopSequenceInput,
} from '../dispatch-routes/utils/route-stop-calc';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StockValidatorService } from '../inventory/shared/services/stock-validator.service';
import { resolvePosStockScope } from '../inventory/shared/helpers/pos-stock-scope.helper';
import { mergeStoreSettingsWithDefaults } from '../settings/defaults/default-store-settings';
import { PurchaseOrdersService } from '../orders/purchase-orders/purchase-orders.service';
import {
  VALID_SUBTYPES_BY_DIRECTION,
  VALID_REASONS_BY_SUBTYPE,
} from './types/dispatch-note-direction.type';
import { DispatchFulfillmentListener } from './listeners/dispatch-fulfillment.listener';
import sharp = require('sharp');

const DISPATCH_NOTE_INCLUDE = {
  dispatch_note_items: {
    include: {
      product: true,
      product_variant: true,
      location: true,
    },
  },
  customer: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
    },
  },
  sales_order: {
    select: {
      id: true,
      order_number: true,
      status: true,
    },
  },
  order: {
    select: {
      id: true,
      order_number: true,
      state: true,
    },
  },
  invoice: {
    select: {
      id: true,
      invoice_number: true,
      status: true,
    },
  },
  dispatch_location: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  confirmed_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  delivered_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  voided_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  // Reverse relation so the UI can show "asignada a planilla #N" on
  // the dispatch note detail / list. Includes the full history (released
  // stops from prior routes) plus the parent route summary.
  dispatch_route_stops: {
    orderBy: { id: 'desc' as const },
    select: {
      id: true,
      route_id: true,
      stop_sequence: true,
      status: true,
      result: true,
      route: {
        select: {
          id: true,
          route_number: true,
          route_code: true,
          status: true,
        },
      },
    },
  },
};

@Injectable()
export class DispatchNotesService {
  private readonly logger = new Logger(DispatchNotesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly dispatchNumberGenerator: DispatchNumberGenerator,
    private readonly routeNumberGenerator: RouteNumberGenerator,
    private readonly eventEmitter: EventEmitter2,
    private readonly stockValidator: StockValidatorService,
    // AIEngineService is provided by the @Global() AIEngineModule, so it is
    // injectable here without importing the module (used by scanReceipt — R4c).
    private readonly aiEngine: AIEngineService,
    // Bug C — recompute orders.dispatch_fulfillment inline for the createFromOrder
    // 'draft' path, which does NOT emit an event but whose draft note already
    // counts toward the rollup. Same module provider (only depends on prisma —
    // no DI cycle).
    private readonly dispatchFulfillment: DispatchFulfillmentListener,
    // Injected for createPurchaseReceipt delegation when purchase_order_id is
    // present. Optional so the module can boot without the PurchaseOrdersModule
    // if that dependency is not wired yet (defensive — the module imports it).
    private readonly purchaseOrdersService?: PurchaseOrdersService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // R4c — Purchase-receipt AI scanner
  // (POST /store/dispatch-notes/receipt-scan)
  // ───────────────────────────────────────────────────────────────────────

  /** Mimetypes accepted by the receipt scanner (mirrors invoice/member scanners). */
  private static readonly RECEIPT_SCAN_ALLOWED_MIMETYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  /**
   * Scan a purchase receipt / supplier invoice (image or PDF) and return
   * suggested line items + supplier, each matched (tenant-scoped) against the
   * store catalog. Does NOT persist anything.
   *
   * 1:1 mechanism calque of InvoiceScannerService / MemberBulkScannerService:
   * validate → preprocess (sharp) → AIEngine.run('invoice_ocr') → defensive JSON
   * parse → normalize → catalog matching. Product/supplier ids are NEVER
   * invented: a match is emitted only on an exact SKU hit (variant or product)
   * or an unambiguous single name match; anything doubtful returns a null id
   * with confidence 'low'/'none'.
   *
   * NOTE (dev): with 0 rows in ai_engine_configs the AI call fails fast with
   * AI_PROVIDER_002 — expected locally; the wiring/contract is still valid.
   */
  async scanReceipt(file?: Express.Multer.File): Promise<ScanReceiptResult> {
    this.assertValidReceiptFile(file);

    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const { base64, mimeType } = await this.preprocessReceiptImage(file!);
    const dataUri = `data:${mimeType};base64,${base64}`;

    const imageMessage: AIMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract all data from this purchase receipt / invoice image. Return ONLY the JSON object matching the schema defined in your system instructions.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    this.logger.debug(
      `[ReceiptScan] Sending to AI engine (appKey=invoice_ocr, size=${file!.size}B)...`,
    );

    const response = await this.aiEngine.run('invoice_ocr', {}, [imageMessage]);

    this.logger.debug(
      `[ReceiptScan] AI response: success=${response.success}, contentLength=${response.content?.length ?? 0}, model=${response.model}, error=${response.error}`,
    );

    if (!response.success || !response.content) {
      this.logger.error(
        `[ReceiptScan] AI failed: ${response.error ?? 'no content'}`,
      );
      throw new VendixHttpException(ErrorCodes.DISPATCH_RECEIPT_SCAN_AI_FAIL);
    }

    let normalized: RawReceiptScan;
    try {
      const parsed = this.parseReceiptAiJson(response.content);
      normalized = this.normalizeReceiptScan(parsed);
    } catch (err: any) {
      if (err instanceof VendixHttpException) throw err;
      this.logger.error(
        `[ReceiptScan] Failed to parse AI response (${err?.message}). Raw content: ${response.content}`,
      );
      throw new VendixHttpException(ErrorCodes.DISPATCH_RECEIPT_SCAN_PARSE_FAIL);
    }

    if (normalized.items.length === 0) {
      throw new VendixHttpException(ErrorCodes.DISPATCH_RECEIPT_SCAN_NO_ITEMS);
    }

    const warnings: string[] = [];

    // ── Supplier matching (tenant-scoped; never invents an id) ──────────────
    const supplier_id = await this.matchReceiptSupplier(
      normalized.supplier,
      warnings,
    );

    // ── Item matching (SKU exact → unambiguous name; per-item best-effort) ──
    const items: ScannedReceiptItem[] = [];
    for (const raw of normalized.items) {
      items.push(await this.matchReceiptItem(raw, warnings));
    }

    return {
      supplier_name: normalized.supplier.name,
      supplier_id,
      currency: normalized.currency,
      items,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  private assertValidReceiptFile(file?: Express.Multer.File): void {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.DISPATCH_RECEIPT_SCAN_NO_FILE);
    }
    if (
      !DispatchNotesService.RECEIPT_SCAN_ALLOWED_MIMETYPES.includes(
        file.mimetype,
      )
    ) {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_RECEIPT_SCAN_INVALID_FILE,
      );
    }
  }

  /**
   * Preprocess the upload for the vision model: downscale big images to 1536px
   * and re-encode as JPEG. PDFs / unsupported types fall through to the raw
   * buffer so the model handles them natively. Copy-on-purpose mirror of
   * InvoiceScannerService.preprocessImage.
   */
  private async preprocessReceiptImage(
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
    } catch (err: any) {
      this.logger.warn(
        `[ReceiptScan] Image preprocessing failed, using raw: ${err?.message}`,
      );
      return {
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
      };
    }
  }

  /**
   * Defensive JSON parse: strip a ```json fence found anywhere, else fall back
   * to the widest `{ ... }` slice. Mirrors MemberBulkScannerService.parseAiJson.
   */
  private parseReceiptAiJson(raw: string): any {
    let content = raw.trim();
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) content = fenceMatch[1].trim();
    try {
      return JSON.parse(content);
    } catch {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(content.slice(start, end + 1));
      }
      throw new Error('No JSON object found in AI response');
    }
  }

  /**
   * Normalize the raw AI JSON into RawReceiptScan. Tolerates both invoice_ocr
   * shapes: items keyed as `line_items` (canonical) or `items`; per item,
   * `description`/`name`/`product_name`, `sku`/`sku_if_visible`, `quantity`,
   * `unit_price`. Supplier tax id accepted as `tax_id` or `nit`.
   */
  private normalizeReceiptScan(parsed: any): RawReceiptScan {
    if (!parsed || typeof parsed !== 'object') {
      throw new VendixHttpException(ErrorCodes.DISPATCH_RECEIPT_SCAN_PARSE_FAIL);
    }
    const rawItems: any[] = Array.isArray(parsed.line_items)
      ? parsed.line_items
      : Array.isArray(parsed.items)
        ? parsed.items
        : [];
    const items: RawReceiptItem[] = rawItems.map((it: any) => ({
      description:
        this.toNonEmptyString(it?.description) ??
        this.toNonEmptyString(it?.name) ??
        this.toNonEmptyString(it?.product_name),
      sku:
        this.toNonEmptyString(it?.sku) ??
        this.toNonEmptyString(it?.sku_if_visible),
      quantity: this.toFiniteNumberOrNull(it?.quantity),
      unit_price: this.toFiniteNumberOrNull(it?.unit_price),
    }));
    return {
      supplier: {
        name:
          this.toNonEmptyString(parsed?.supplier?.name) ??
          this.toNonEmptyString(parsed?.supplier_name),
        tax_id:
          this.toNonEmptyString(parsed?.supplier?.tax_id) ??
          this.toNonEmptyString(parsed?.supplier?.nit) ??
          this.toNonEmptyString(parsed?.supplier_tax_id),
      },
      currency: this.toNonEmptyString(parsed?.currency),
      items,
    };
  }

  private toNonEmptyString(v: any): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  }

  private toFiniteNumberOrNull(v: any): number | null {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Match the extracted supplier against the store's suppliers (tenant-scoped).
   * Tier 1: exact tax_id/NIT (separator-tolerant, case-insensitive). Tier 2:
   * exact name (case-insensitive, unambiguous). Returns the id on a confident
   * match, else null (and pushes a warning). Never throws.
   */
  private async matchReceiptSupplier(
    supplier: RawReceiptScan['supplier'],
    warnings: string[],
  ): Promise<number | null> {
    try {
      if (supplier.tax_id) {
        const normalizedTax = supplier.tax_id.replace(/[\s\-.]/g, '');
        if (normalizedTax) {
          const byTax = await this.prisma.suppliers.findFirst({
            where: { tax_id: { equals: normalizedTax, mode: 'insensitive' } },
            select: { id: true },
          });
          if (byTax) return byTax.id;
        }
      }
      if (supplier.name) {
        const byName = await this.prisma.suppliers.findMany({
          where: { name: { equals: supplier.name, mode: 'insensitive' } },
          select: { id: true },
          take: 2,
        });
        if (byName.length === 1) return byName[0].id;
      }
    } catch (err: any) {
      this.logger.warn(
        `[ReceiptScan] Supplier matching failed: ${err?.message}`,
      );
    }
    if (supplier.name) {
      warnings.push(
        `Proveedor "${supplier.name}" no se pudo asociar automáticamente; selecciónalo o créalo manualmente.`,
      );
    }
    return null;
  }

  /**
   * Match one extracted item against the store catalog (tenant-scoped) without
   * ever inventing an id:
   *   1. SKU exact on a product_variant → matched_variant_id + parent product,
   *      confidence 'high'.
   *   2. SKU exact on a product → matched_product_id, confidence 'high'.
   *   3. Unambiguous single name match (contains, case-insensitive, non-archived)
   *      → matched_product_id, confidence 'high'.
   *   4. Ambiguous (multiple name matches) → null id, confidence 'low'.
   *   5. No match → null id, confidence 'none'.
   */
  private async matchReceiptItem(
    raw: RawReceiptItem,
    warnings: string[],
  ): Promise<ScannedReceiptItem> {
    const product_name = raw.description ?? '';
    const base: ScannedReceiptItem = {
      product_name,
      sku: raw.sku,
      quantity: raw.quantity ?? 0,
      unit_price: raw.unit_price,
      matched_product_id: null,
      matched_variant_id: null,
      match_confidence: 'none',
    };

    try {
      // 1 + 2 — SKU exact (variant first, then product).
      if (raw.sku) {
        const variant = await this.prisma.product_variants.findFirst({
          where: { sku: { equals: raw.sku, mode: 'insensitive' } },
          select: { id: true, product_id: true },
        });
        if (variant) {
          return {
            ...base,
            matched_product_id: variant.product_id,
            matched_variant_id: variant.id,
            match_confidence: 'high',
          };
        }
        const product = await this.prisma.products.findFirst({
          where: { sku: { equals: raw.sku, mode: 'insensitive' } },
          select: { id: true },
        });
        if (product) {
          return {
            ...base,
            matched_product_id: product.id,
            match_confidence: 'high',
          };
        }
      }

      // 3 + 4 — name contains (unambiguous → high, ambiguous → low).
      if (product_name.trim().length > 0) {
        const byName = await this.prisma.products.findMany({
          where: {
            name: { contains: product_name.trim(), mode: 'insensitive' },
            state: { not: 'archived' },
          },
          select: { id: true },
          take: 2,
        });
        if (byName.length === 1) {
          return {
            ...base,
            matched_product_id: byName[0].id,
            match_confidence: 'high',
          };
        }
        if (byName.length > 1) {
          warnings.push(
            `"${product_name}" coincide con varios productos; selecciónalo manualmente.`,
          );
          return { ...base, match_confidence: 'low' };
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `[ReceiptScan] Item matching failed for "${product_name}": ${err?.message}`,
      );
    }

    warnings.push(
      `"${product_name || 'Ítem sin nombre'}" sin coincidencias en el catálogo.`,
    );
    return base;
  }

  /**
   * Build the delivery-address snapshot persisted on `dispatch_notes.customer_address`
   * (JSON). The PDF reads this blob in cascade (see
   * `dispatch-note-pdf.service.formatJsonAddress`), so the keys MUST be the
   * `addresses` TABLE column names (`address_line1`, `state_province`,
   * `country_code`, ...), NOT the DTO vocabulary (address_line_1 / state / country).
   *
   * Priority:
   *   1. A `shipping_address_snapshot` JSON already captured on the order — reused
   *      verbatim (it is already in column-name shape from the order flow).
   *   2. The populated shipping-address relation row — projected to the snapshot
   *      shape.
   * Returns `null` when neither source carries a non-empty address line.
   */
  private buildCustomerAddressSnapshot(
    snapshot: Prisma.JsonValue | null | undefined,
    relation:
      | {
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state_province?: string | null;
          country_code?: string | null;
          postal_code?: string | null;
          /**
           * GPS coordinates persisted on the `addresses` table. Captured by
           * the checkout map-picker; copied into the snapshot so the carrier
           * route-map can geolocate stops without a geocoding round-trip.
           * Optional because legacy addresses may have null coords.
           */
          latitude?: number | string | null;
          longitude?: number | string | null;
        }
      | null
      | undefined,
  ): Prisma.InputJsonValue | null {
    // (1) Prefer the order's own snapshot when it actually carries a line,
    // pero inyecta lat/lng si faltan (fallback a relation).
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      const s = snapshot as Record<string, unknown>;
      const line1 = s.address_line1 ?? s.line1 ?? s.address;
      if (typeof line1 === 'string' && line1.trim().length > 0) {
        return this.withCoordsFallback(s, relation);
      }
    }

    // (2) Fall back to the relation row, projected to column-name keys. Lat/Lng
    // are projected when finite — we use a NUMBER not a string (Prisma returns
    // numerics as strings by default, but the frontend `DispatchDeliveryAddress`
    // type expects `number`).
    if (relation && relation.address_line1 && relation.address_line1.trim()) {
      const lat = this.toFiniteNumber(relation.latitude);
      const lng = this.toFiniteNumber(relation.longitude);
      return {
        address_line1: relation.address_line1,
        address_line2: relation.address_line2 ?? null,
        city: relation.city ?? null,
        state_province: relation.state_province ?? null,
        country_code: relation.country_code ?? null,
        postal_code: relation.postal_code ?? null,
        ...(lat !== null ? { latitude: lat } : {}),
        ...(lng !== null ? { longitude: lng } : {}),
      };
    }

    return null;
  }

  /**
   * Shallow-mergea lat/lng de `relation` en el snapshot dict `s` si el snapshot
   * no los trae pero relation sí. Preserva todas las claves originales del snapshot.
   */
  private withCoordsFallback(
    s: Record<string, unknown>,
    relation:
      | {
          latitude?: number | string | null;
          longitude?: number | string | null;
        }
      | null
      | undefined,
  ): Prisma.InputJsonValue {
    // Si el snapshot ya tiene coords finitas, devolver intacto.
    const hasLat = this.toFiniteNumber(s.latitude as any) !== null;
    const hasLng = this.toFiniteNumber(s.longitude as any) !== null;
    if (hasLat && hasLng) {
      return s as Prisma.InputJsonValue;
    }

    // Intentar inyectar coords de relation.
    const lat = this.toFiniteNumber(relation?.latitude);
    const lng = this.toFiniteNumber(relation?.longitude);
    return {
      ...s,
      ...(lat !== null ? { latitude: lat } : {}),
      ...(lng !== null ? { longitude: lng } : {}),
    } as Prisma.InputJsonValue;
  }

  /**
   * Coerce a Prisma numeric/string to a finite `number`, or `null` if not
   * representable. Used to project optional `addresses.latitude/longitude`
   * (Prisma returns `Decimal` as string) into the JSON snapshot the carrier
   * route-map reads.
   */
  private toFiniteNumber(
    value: number | string | null | undefined,
  ): number | null {
    if (value === null || value === undefined) return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** True when the order's snapshot JSON carries a usable address line. */
  private snapshotHasAddress(
    snapshot: Prisma.JsonValue | null | undefined,
  ): boolean {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return false;
    }
    const s = snapshot as Record<string, unknown>;
    const line1 = s.address_line1 ?? s.line1 ?? s.address;
    return typeof line1 === 'string' && line1.trim().length > 0;
  }

  /**
   * Resolve the default dispatch location for an order: the location of an
   * ACTIVE stock reservation for the order, falling back to the store's
   * `default_location_id` (via the POS stock scope helper). Returns null when
   * neither is available (caller then keeps any per-item location_id as-is).
   */
  private async resolveDefaultDispatchLocation(
    store_id: number,
    order_id: number,
  ): Promise<number | null> {
    // stock_reservations is relationally scoped to the store via
    // inventory_locations.store_id, so this query is already store-safe.
    const reservation = await this.prisma.stock_reservations.findFirst({
      where: {
        reserved_for_type: 'order',
        reserved_for_id: order_id,
        status: 'active',
      },
      select: { location_id: true },
      orderBy: { id: 'asc' },
    });
    if (reservation?.location_id) return reservation.location_id;

    // Fallback: the store's default location via the POS stock scope helper.
    // `stores` is NOT auto-scoped by StorePrismaService → filter store_id.
    const store = await this.prisma.stores.findFirst({
      where: { id: store_id },
      select: { default_location_id: true },
    });
    if (!store) return null;
    const settingsRow = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    const settings = mergeStoreSettingsWithDefaults(settingsRow?.settings);
    const scope = resolvePosStockScope(store, settings);
    return scope.mainLocationId ?? null;
  }

  /**
   * Validate that every dispatch item has enough stock at its resolved
   * location. A remisión dispatches what is ALREADY RESERVED for this order, so
   * the units reserved for THIS order count as available on top of the live
   * `quantity_available`. Only a real shortfall (available + reserved-for-order
   * < dispatched) raises `DISPATCH_NOTE_INSUFFICIENT_STOCK`.
   */
  private async validateDispatchItemsStock(
    store_id: number,
    order_id: number,
    items: Array<{
      product_id: number;
      product_variant_id: number | null;
      location_id: number | null;
      dispatched_quantity: number;
    }>,
  ): Promise<void> {
    const insufficient: Array<{
      product_id: number;
      product_variant_id: number | null;
      requested: number;
      available: number;
    }> = [];

    for (const item of items) {
      if (item.location_id == null) continue; // no location → skip (no scope to check)
      const qty = Number(item.dispatched_quantity || 0);
      if (qty <= 0) continue;

      // Skip products that do not track inventory.
      const tracks = await this.stockValidator.doesProductTrackInventory(
        item.product_id,
        item.product_variant_id ?? undefined,
      );
      if (!tracks) continue;

      const availability = await this.stockValidator.validateAvailability(
        item.product_id,
        item.product_variant_id ?? undefined,
        qty,
        item.location_id,
      );

      // Reserved-for-THIS-order units count as dispatchable: the remisión
      // consumes the reservation, so they are not a real shortfall.
      const reserved = await this.prisma.stock_reservations.aggregate({
        where: {
          reserved_for_type: 'order',
          reserved_for_id: order_id,
          status: 'active',
          location_id: item.location_id,
          product_id: item.product_id,
          product_variant_id: item.product_variant_id ?? null,
        },
        _sum: { quantity: true },
      });
      const reservedForOrder = Number(reserved._sum.quantity || 0);
      const effectiveAvailable = availability.available + reservedForOrder;

      if (effectiveAvailable < qty) {
        insufficient.push({
          product_id: item.product_id,
          product_variant_id: item.product_variant_id ?? null,
          requested: qty,
          available: effectiveAvailable,
        });
      }
    }

    if (insufficient.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_NOTE_INSUFFICIENT_STOCK,
        undefined,
        { items: insufficient },
      );
    }
  }

  /**
   * Validate cross-field invariants that the DTO cannot enforce on its own
   * (per vendix-validation: cross-field invariants live in the service,
   * post-lookup). Checks subtype↔direction and reason↔subtype consistency.
   */
  private validateDirectionSubtypeInvariants(
    direction: dispatch_note_direction_enum,
    subtype: dispatch_note_subtype_enum,
    reason?: dispatch_note_reason_enum | null,
  ): void {
    const validSubtypes = VALID_SUBTYPES_BY_DIRECTION[direction];
    if (!validSubtypes || !validSubtypes.includes(subtype)) {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_NOTE_INVALID_SUBTYPE_FOR_DIRECTION,
        undefined,
        { direction, subtype },
      );
    }
    if (reason) {
      const validReasons = VALID_REASONS_BY_SUBTYPE[subtype];
      if (validReasons && !validReasons.includes(reason)) {
        throw new VendixHttpException(
          ErrorCodes.DISPATCH_NOTE_INVALID_SUBTYPE_FOR_DIRECTION,
          `Reason '${reason}' is not valid for subtype '${subtype}'`,
          { direction, subtype, reason },
        );
      }
    }
  }

  async create(dto: CreateDispatchNoteDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // ── Direction/subtype/reason resolution + invariant validation ──
    // Backward-compat: when dto.direction is undefined (legacy callers),
    // default to outbound + customer_delivery (the pre-bidirectional behavior).
    const direction: dispatch_note_direction_enum =
      dto.direction ?? dispatch_note_direction_enum.outbound;
    const subtype: dispatch_note_subtype_enum =
      dto.subtype ?? dispatch_note_subtype_enum.customer_delivery;
    const reason = (dto.reason as dispatch_note_reason_enum | undefined) ?? null;

    this.validateDirectionSubtypeInvariants(direction, subtype, reason);

    // Inbound customer_return requires related_dispatch_id
    if (
      direction === dispatch_note_direction_enum.inbound &&
      subtype === dispatch_note_subtype_enum.customer_return &&
      !dto.related_dispatch_id
    ) {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_NOTE_RETURN_REQUIRES_RELATED,
      );
    }

    // Inbound purchase_receipt requires supplier_id
    if (
      direction === dispatch_note_direction_enum.inbound &&
      subtype === dispatch_note_subtype_enum.purchase_receipt &&
      !dto.supplier_id
    ) {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_NOTE_RECEIPT_REQUIRES_SUPPLIER,
      );
    }

    // Validate related_dispatch_id belongs to same store when present
    if (dto.related_dispatch_id) {
      const related = await this.prisma.dispatch_notes.findFirst({
        where: { id: dto.related_dispatch_id, store_id },
        select: { id: true, direction: true, subtype: true },
      });
      if (!related) {
        throw new VendixHttpException(
          ErrorCodes.DISPATCH_NOTE_RETURN_REQUIRES_RELATED,
          'The related dispatch note was not found in this store',
          { related_dispatch_id: dto.related_dispatch_id },
        );
      }
    }

    // Denormalize customer data
    const customer = await this.prisma.users.findUnique({
      where: { id: dto.customer_id },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        document_number: true,
      },
    });

    if (!customer) {
      throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
    }

    const customer_name =
      `${customer.first_name || ''} ${customer.last_name || ''}`.trim();

    // Calculate totals from items
    const items: any[] = dto.items || [];
    const subtotal = items.reduce(
      (sum, item) =>
        sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_discount = items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const total_tax = items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal - total_discount + total_tax;

    let retries = 3;
    while (retries > 0) {
      try {
        const dispatch_number =
          await this.dispatchNumberGenerator.generateNextNumber(store_id);

        const dispatch_note = await this.prisma.dispatch_notes.create({
          data: {
            store_id,
            dispatch_number,
            status: dispatch_note_status_enum.draft,
            direction,
            subtype,
            reason,
            customer_id: dto.customer_id,
            customer_name,
            customer_tax_id: customer.document_number || null,
            sales_order_id: dto.sales_order_id,
            dispatch_location_id: dto.dispatch_location_id,
            supplier_id: dto.supplier_id ?? null,
            related_dispatch_id: dto.related_dispatch_id ?? null,
            from_location_id: dto.from_location_id ?? null,
            to_location_id: dto.to_location_id ?? null,
            emission_date: dto.emission_date
              ? new Date(dto.emission_date)
              : new Date(),
            agreed_delivery_date: dto.agreed_delivery_date
              ? new Date(dto.agreed_delivery_date)
              : null,
            subtotal_amount: subtotal,
            discount_amount: total_discount,
            tax_amount: total_tax,
            grand_total,
            currency: dto.currency || 'COP',
            notes: dto.notes,
            internal_notes: dto.internal_notes,
            created_by_user_id: context?.user_id,
            updated_at: new Date(),
            dispatch_note_items: {
              create: items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                location_id: item.location_id,
                ordered_quantity: item.ordered_quantity,
                dispatched_quantity: item.dispatched_quantity,
                unit_price: item.unit_price,
                discount_amount: item.discount_amount || 0,
                tax_amount: item.tax_amount || 0,
                total_price:
                  Number(item.unit_price || 0) * item.dispatched_quantity -
                  Number(item.discount_amount || 0) +
                  Number(item.tax_amount || 0),
                lot_serial: item.lot_serial,
                sales_order_item_id: item.sales_order_item_id,
              })),
            },
          },
          include: DISPATCH_NOTE_INCLUDE,
        });

        return dispatch_note;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = error.meta?.target as string[];
          if (Array.isArray(target) && target.includes('dispatch_number')) {
            retries--;
            if (retries === 0) {
              throw new ConflictException(
                'No se pudo generar un número de remisión único después de varios intentos',
              );
            }
            continue;
          }
        }
        throw error;
      }
    }
  }

  /**
   * Create a transfer dispatch note (outbound transfer_out or inbound
   * transfer_in). Cross-store transfers are blocked in STORE operating scope
   * (per vendix-operating-scope). The stock movement is deferred:
   *   - transfer_out: the `dispatch_note.delivered` event deducts stock from
   *     the origin location (movement_type stock_out via OrderStockCommitService).
   *   - transfer_in: the `dispatch_note.received` event adds stock at the
   *     destination location (movement_type transfer via StockLevelManager).
   *
   * Decision: EMIT-OWN. We create the dispatch_note here; the actual stock
   * movement happens at state transition (delivered/received). We do NOT
   * call StockLevelManager here — the listener handles it.
   */
  async createTransfer(dto: CreateTransferDispatchDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id ?? dto.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // Validate direction↔subtype consistency
    this.validateDirectionSubtypeInvariants(
      dto.direction as dispatch_note_direction_enum,
      dto.subtype as dispatch_note_subtype_enum,
      (dto.reason as dispatch_note_reason_enum | undefined) ?? null,
    );

    // Cross-store scope guard: in STORE operating scope, from_location and
    // to_location must belong to the same store. We check by looking up both
    // locations and verifying their store_id matches the context store_id.
    const [fromLoc, toLoc] = await Promise.all([
      this.prisma.inventory_locations.findFirst({
        where: { id: dto.from_location_id },
        select: { id: true, store_id: true },
      }),
      this.prisma.inventory_locations.findFirst({
        where: { id: dto.to_location_id },
        select: { id: true, store_id: true },
      }),
    ]);

    if (!fromLoc || !toLoc) {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_NOTE_CROSS_STORE_TRANSFER_BLOCKED,
        'One or both locations were not found',
        {
          from_location_id: dto.from_location_id,
          to_location_id: dto.to_location_id,
        },
      );
    }

    if (fromLoc.store_id !== store_id || toLoc.store_id !== store_id) {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_NOTE_CROSS_STORE_TRANSFER_BLOCKED,
      );
    }

    // Calculate totals from items
    const items: any[] = dto.items || [];
    const subtotal = items.reduce(
      (sum, item) =>
        sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_discount = items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const total_tax = items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal - total_discount + total_tax;

    let retries = 3;
    while (retries > 0) {
      try {
        const dispatch_number =
          await this.dispatchNumberGenerator.generateNextNumber(store_id);

        const dispatch_note = await this.prisma.dispatch_notes.create({
          data: {
            store_id,
            dispatch_number,
            status: dispatch_note_status_enum.draft,
            direction: dto.direction as dispatch_note_direction_enum,
            subtype: dto.subtype as dispatch_note_subtype_enum,
            reason: (dto.reason as dispatch_note_reason_enum | undefined) ?? null,
            // Transfers have no customer — their party is the other location
            // (from_location_id / to_location_id). customer_id is nullable for
            // non-customer flows (migration 20260715214000); leaving it null
            // avoids contaminating the operator's record and blocking its
            // deletion via the dispatch_notes_customer Restrict FK.
            customer_id: null,
            customer_name: null,
            from_location_id: dto.from_location_id,
            to_location_id: dto.to_location_id,
            dispatch_location_id:
              dto.direction === 'outbound'
                ? dto.from_location_id
                : dto.to_location_id,
            emission_date: dto.emission_date ? new Date(dto.emission_date) : new Date(),
            subtotal_amount: subtotal,
            discount_amount: total_discount,
            tax_amount: total_tax,
            grand_total,
            currency: 'COP',
            notes: dto.notes,
            internal_notes: dto.internal_notes,
            created_by_user_id: context?.user_id,
            updated_at: new Date(),
            dispatch_note_items: {
              create: items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                location_id:
                  item.location_id ??
                  (dto.direction === 'outbound'
                    ? dto.from_location_id
                    : dto.to_location_id),
                ordered_quantity: item.ordered_quantity,
                dispatched_quantity: item.dispatched_quantity,
                unit_price: item.unit_price ?? 0,
                discount_amount: item.discount_amount || 0,
                tax_amount: item.tax_amount || 0,
                total_price:
                  Number(item.unit_price || 0) * item.dispatched_quantity -
                  Number(item.discount_amount || 0) +
                  Number(item.tax_amount || 0),
                lot_serial: item.lot_serial,
                sales_order_item_id: item.sales_order_item_id,
              })),
            },
          },
          include: DISPATCH_NOTE_INCLUDE,
        });

        return dispatch_note;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = error.meta?.target as string[];
          if (Array.isArray(target) && target.includes('dispatch_number')) {
            retries--;
            if (retries === 0) {
              throw new ConflictException(
                'No se pudo generar un número de remisión único después de varios intentos',
              );
            }
            continue;
          }
        }
        throw error;
      }
    }
  }

  /**
   * Create a customer return dispatch note (inbound, subtype customer_return).
   *
   * Decision: EMIT-OWN for the dispatch_note creation. The financial refund
   * (credit note, return_orders processing) is NOT coupled here — it goes
   * through return_orders separately (v1 decoupling). The stock restock
   * happens at the `dispatch_note.received` event via the listener
   * (movement_type 'return', quantity_change +qty). If the user wants a
   * refund, they create a return_orders record separately.
   *
   * related_dispatch_id is required and validated to exist + belong to same store.
   */
  async createReturn(dto: CreateReturnDispatchDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // Validate direction↔subtype↔reason consistency
    this.validateDirectionSubtypeInvariants(
      dto.direction as dispatch_note_direction_enum,
      dto.subtype as dispatch_note_subtype_enum,
      dto.reason as dispatch_note_reason_enum,
    );

    // Validate related_dispatch_id exists and belongs to same store
    const related = await this.prisma.dispatch_notes.findFirst({
      where: { id: dto.related_dispatch_id, store_id },
      include: {
        dispatch_note_items: {
          select: {
            id: true,
            product_id: true,
            product_variant_id: true,
            dispatched_quantity: true,
            unit_price: true,
            location_id: true,
          },
        },
        customer: {
          select: { id: true, first_name: true, last_name: true, document_number: true },
        },
      },
    });
    if (!related) {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_NOTE_RETURN_REQUIRES_RELATED,
        'The related dispatch note was not found in this store',
        { related_dispatch_id: dto.related_dispatch_id },
      );
    }

    // Denormalize customer data from the original dispatch
    const customer = related.customer;
    const customer_name =
      `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim();

    // Calculate totals from items
    const items: any[] = dto.items || [];
    const subtotal = items.reduce(
      (sum, item) =>
        sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_discount = items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const total_tax = items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal - total_discount + total_tax;

    // Resolve the restock location: explicit to_location_id, or the original
    // dispatch's dispatch_location_id, or the first item's location.
    const restock_location_id =
      dto.to_location_id ??
      related.dispatch_location_id ??
      related.dispatch_note_items[0]?.location_id ??
      null;

    let retries = 3;
    while (retries > 0) {
      try {
        const dispatch_number =
          await this.dispatchNumberGenerator.generateNextNumber(store_id);

        const dispatch_note = await this.prisma.dispatch_notes.create({
          data: {
            store_id,
            dispatch_number,
            status: dispatch_note_status_enum.draft,
            direction: dispatch_note_direction_enum.inbound,
            subtype: dispatch_note_subtype_enum.customer_return,
            reason: dto.reason as dispatch_note_reason_enum,
            customer_id: dto.customer_id,
            customer_name,
            customer_tax_id: customer?.document_number || null,
            related_dispatch_id: dto.related_dispatch_id,
            to_location_id: restock_location_id,
            dispatch_location_id: restock_location_id,
            emission_date: dto.emission_date ? new Date(dto.emission_date) : new Date(),
            subtotal_amount: subtotal,
            discount_amount: total_discount,
            tax_amount: total_tax,
            grand_total,
            currency: 'COP',
            notes: dto.notes,
            internal_notes: dto.internal_notes,
            created_by_user_id: context?.user_id,
            updated_at: new Date(),
            dispatch_note_items: {
              create: items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                location_id: item.location_id ?? restock_location_id,
                ordered_quantity: item.ordered_quantity,
                dispatched_quantity: item.dispatched_quantity,
                unit_price: item.unit_price ?? 0,
                discount_amount: item.discount_amount || 0,
                tax_amount: item.tax_amount || 0,
                total_price:
                  Number(item.unit_price || 0) * item.dispatched_quantity -
                  Number(item.discount_amount || 0) +
                  Number(item.tax_amount || 0),
                lot_serial: item.lot_serial,
              })),
            },
          },
          include: DISPATCH_NOTE_INCLUDE,
        });

        return dispatch_note;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = error.meta?.target as string[];
          if (Array.isArray(target) && target.includes('dispatch_number')) {
            retries--;
            if (retries === 0) {
              throw new ConflictException(
                'No se pudo generar un número de remisión único después de varios intentos',
              );
            }
            continue;
          }
        }
        throw error;
      }
    }
  }

  /**
   * Create a purchase receipt dispatch note (inbound, subtype purchase_receipt).
   *
   * Decision: DELEGATE to PurchaseOrdersService.receive when purchase_order_id
   * is present — that service handles reception records, stock-in, cost layers,
   * IVA lifecycle, and purchase order status updates. When purchase_order_id
   * is absent, EMIT-OWN: create the dispatch_note here; the `received` event
   * fires stockLevelManager.updateStock({movement_type:'stock_in', ...}).
   *
   * supplier_id is required (DTO enforces it).
   */
  async createPurchaseReceipt(dto: CreatePurchaseReceiptDispatchDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // Validate direction↔subtype↔reason consistency
    this.validateDirectionSubtypeInvariants(
      dto.direction as dispatch_note_direction_enum,
      dto.subtype as dispatch_note_subtype_enum,
      dto.reason as dispatch_note_reason_enum,
    );

    // Order-first bridge: when purchase_order_id is present we CREATE the
    // remisión as the DOCUMENT (draft, inbound, purchase_receipt) with the PO
    // linked. We do NOT do any stock-in here — the canonical stock-in / FIFO /
    // UoM / IVA / accounting all run later, ONCE, when the remisión is received:
    // the `dispatch_note.received` listener delegates to
    // PurchaseOrdersService.receive() (the canonical engine). This keeps the PO
    // reception path as the single source of truth for stock and avoids the
    // double stock-in that a here-and-now delegation would have caused.
    let purchase_order_id: number | null = null;
    let resolved_supplier_id = dto.supplier_id;
    let po_location_id: number | null = null;
    if (dto.purchase_order_id) {
      // Validate the PO exists and is visible in this store (relationally
      // scoped through location.store_id). Pull its lines so we can validate
      // that every received line maps to a real PO line, and default the
      // destination location + supplier from the PO (the PO is authoritative).
      const purchase_order = await this.prisma.purchase_orders.findFirst({
        where: { id: dto.purchase_order_id },
        include: { purchase_order_items: true },
      });
      if (!purchase_order) {
        throw new NotFoundException(
          `Orden de compra #${dto.purchase_order_id} no encontrada`,
        );
      }

      // Validate each received line maps to a PO line — by explicit
      // purchase_order_item_id when provided, else by product_id (+ variant).
      // The received-side re-derivation (in the listener) uses the same match.
      for (const item of dto.items) {
        const poLine = item.purchase_order_item_id
          ? purchase_order.purchase_order_items.find(
              (p) => p.id === item.purchase_order_item_id,
            )
          : purchase_order.purchase_order_items.find(
              (p) =>
                p.product_id === item.product_id &&
                (p.product_variant_id ?? null) ===
                  (item.product_variant_id ?? null),
            );
        if (!poLine) {
          throw new BadRequestException(
            `El producto #${item.product_id} no pertenece a la orden de compra #${dto.purchase_order_id}`,
          );
        }
      }

      purchase_order_id = purchase_order.id;
      resolved_supplier_id = purchase_order.supplier_id ?? dto.supplier_id;
      po_location_id = purchase_order.location_id ?? null;
    }

    // Both paths create the dispatch_note here. The `received` event decides the
    // stock path (EMIT-OWN stock_in when purchase_order_id is null vs. PO.receive
    // delegation when it is set) — see dispatch-note-events.listener.ts.
    const items: any[] = dto.items || [];
    const subtotal = items.reduce(
      (sum, item) =>
        sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_tax = items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal + total_tax;

    // Resolve the receipt location. For the order-first path the PO's own
    // location is the canonical stock-in destination (PurchaseOrdersService.receive
    // uses purchaseOrder.location_id), so fall back to it for display consistency.
    const receipt_location_id =
      dto.to_location_id ??
      items[0]?.location_id ??
      po_location_id ??
      null;

    let retries = 3;
    while (retries > 0) {
      try {
        const dispatch_number =
          await this.dispatchNumberGenerator.generateNextNumber(store_id);

        const dispatch_note = await this.prisma.dispatch_notes.create({
          data: {
            store_id,
            dispatch_number,
            status: dispatch_note_status_enum.draft,
            direction: dispatch_note_direction_enum.inbound,
            subtype: dispatch_note_subtype_enum.purchase_receipt,
            reason: dto.reason as dispatch_note_reason_enum,
            // Purchase receipts have no customer — their party is the supplier
            // (supplier_id). customer_id is nullable for non-customer flows
            // (migration 20260715214000); leaving it null avoids contaminating
            // the operator's record and blocking its deletion via the
            // dispatch_notes_customer Restrict FK.
            customer_id: null,
            customer_name: null,
            supplier_id: resolved_supplier_id,
            purchase_order_id: purchase_order_id ?? undefined,
            related_dispatch_id: dto.related_dispatch_id ?? null,
            to_location_id: receipt_location_id ?? undefined,
            dispatch_location_id: receipt_location_id ?? undefined,
            emission_date: dto.emission_date ? new Date(dto.emission_date) : new Date(),
            subtotal_amount: subtotal,
            discount_amount: 0,
            tax_amount: total_tax,
            grand_total,
            currency: dto.currency ?? 'COP',
            notes: dto.notes,
            internal_notes: dto.internal_notes,
            created_by_user_id: context?.user_id,
            updated_at: new Date(),
            dispatch_note_items: {
              create: items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                location_id: item.location_id ?? receipt_location_id ?? undefined,
                ordered_quantity: item.ordered_quantity,
                dispatched_quantity: item.dispatched_quantity,
                unit_price: item.unit_price ?? 0,
                discount_amount: item.discount_amount || 0,
                tax_amount: item.tax_amount || 0,
                total_price:
                  Number(item.unit_price || 0) * item.dispatched_quantity -
                  Number(item.discount_amount || 0) +
                  Number(item.tax_amount || 0),
                lot_serial: item.lot_serial,
              })),
            },
          },
          include: DISPATCH_NOTE_INCLUDE,
        });

        return dispatch_note;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = error.meta?.target as string[];
          if (Array.isArray(target) && target.includes('dispatch_number')) {
            retries--;
            if (retries === 0) {
              throw new ConflictException(
                'No se pudo generar un número de remisión único después de varios intentos',
              );
            }
            continue;
          }
        }
        throw error;
      }
    }
  }

  async createFromSalesOrder(
    sales_order_id: number,
    dto: CreateFromSalesOrderDto,
  ) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // Fetch the sales order with items + shipping address relation (sales_orders
    // have no snapshot JSON, the relation row is the only address source).
    const sales_order = await this.prisma.sales_orders.findFirst({
      where: { id: sales_order_id },
      include: {
        sales_order_items: {
          include: {
            product: { select: { id: true, name: true } },
            product_variant: { select: { id: true, sku: true } },
          },
        },
        customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            document_number: true,
          },
        },
        addresses: {
          select: {
            address_line1: true,
            address_line2: true,
            city: true,
            state_province: true,
            country_code: true,
            postal_code: true,
            // Captured by the checkout map-picker; copied into the snapshot
            // so the carrier route-map can geolocate stops without a
            // geocoding round-trip. See `buildCustomerAddressSnapshot`.
            latitude: true,
            longitude: true,
          },
        },
      },
    });

    if (!sales_order) {
      throw new NotFoundException('Orden de venta no encontrada');
    }

    // Delivery address gate + snapshot (same contract as createFromOrder).
    const customer_address_snapshot = this.buildCustomerAddressSnapshot(
      null,
      sales_order.addresses,
    );
    if (!customer_address_snapshot) {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_NOTE_NO_SHIPPING_ADDRESS,
      );
    }

    const customer_name =
      `${sales_order.customer?.first_name || ''} ${sales_order.customer?.last_name || ''}`.trim();

    // Build items from sales order items
    const items_map = new Map(dto.items.map((i) => [i.sales_order_item_id, i]));

    const dispatch_items: any[] = [];
    for (const dto_item of dto.items) {
      const so_item = sales_order.sales_order_items.find(
        (si: any) => si.id === dto_item.sales_order_item_id,
      );

      if (!so_item) {
        throw new BadRequestException(
          `Item de orden de venta #${dto_item.sales_order_item_id} no encontrado`,
        );
      }

      dispatch_items.push({
        product_id: so_item.product_id,
        product_variant_id: so_item.product_variant_id,
        location_id: dto_item.location_id,
        ordered_quantity: so_item.quantity,
        dispatched_quantity: dto_item.dispatched_quantity,
        unit_price: so_item.unit_price,
        discount_amount: so_item.discount_amount || 0,
        tax_amount: so_item.tax_amount || 0,
        total_price:
          Number(so_item.unit_price || 0) * dto_item.dispatched_quantity -
          Number(so_item.discount_amount || 0) +
          Number(so_item.tax_amount || 0),
        lot_serial: dto_item.lot_serial,
        sales_order_item_id: dto_item.sales_order_item_id,
      });
    }

    const subtotal = dispatch_items.reduce(
      (sum, item) =>
        sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_discount = dispatch_items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const total_tax = dispatch_items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal - total_discount + total_tax;

    const dispatch_number =
      await this.dispatchNumberGenerator.generateNextNumber(store_id);

    const dispatch_note = await this.prisma.dispatch_notes.create({
      data: {
        store_id,
        dispatch_number,
        status: dispatch_note_status_enum.draft,
        customer_id: sales_order.customer_id,
        customer_name,
        customer_tax_id: sales_order.customer?.document_number || null,
        // Delivery-address snapshot read by the remisión PDF in cascade.
        customer_address: customer_address_snapshot ?? Prisma.JsonNull,
        sales_order_id,
        dispatch_location_id: dto.dispatch_location_id,
        emission_date: new Date(),
        agreed_delivery_date: dto.agreed_delivery_date
          ? new Date(dto.agreed_delivery_date)
          : null,
        subtotal_amount: subtotal,
        discount_amount: total_discount,
        tax_amount: total_tax,
        grand_total,
        currency: sales_order.currency || 'COP',
        notes: dto.notes,
        created_by_user_id: context?.user_id,
        updated_at: new Date(),
        dispatch_note_items: {
          create: dispatch_items,
        },
      },
      include: DISPATCH_NOTE_INCLUDE,
    });

    return dispatch_note;
  }

  /**
   * Create a dispatch note (remisión) straight from an order, optionally
   * confirming it and/or attaching it to a route — all in ONE atomic
   * transaction. This is the "atajo de despacho COD" shortcut: a single call
   * can create the remisión, leave it confirmed, and either drop it on an
   * existing hot route or spin up a brand-new route with driver/vehicle/
   * assistants and the remisión as its first stop.
   *
   * Atomicity: the remisión and the route/stop writes share one `$transaction`,
   * so a failure on the route side rolls back the remisión too. Side effects
   * that must run AFTER the data is durable (the `dispatch_note.confirmed`
   * event that reserves stock) are emitted post-commit.
   */
  async createFromOrder(order_id: number, dto: CreateFromOrderDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const user_id = context?.user_id;

    // Resolve and validate the target status up front so we fail fast with the
    // correct code before touching the DB.
    const target_status: 'draft' | 'confirmed' = dto.target_status ?? 'draft';
    if (target_status !== 'draft' && target_status !== 'confirmed') {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_TARGET_STATUS_001);
    }

    // Validate the route_assignment shape (DTO already guards required fields
    // per mode, but we re-assert here to throw the domain code, not a 422).
    const assignment_mode = dto.route_assignment?.mode ?? 'none';
    if (assignment_mode === 'existing' && !dto.route_assignment?.route_id) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_ASSIGN_001);
    }
    if (assignment_mode === 'new' && !dto.route_assignment?.new_route) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_ASSIGN_001);
    }

    // Fetch the order with items (store-scoped via StorePrismaService).
    // Includes the shipping address (snapshot JSON + populated relation) so we
    // can validate it exists and snapshot it on the remisión.
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      include: {
        order_items: true,
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            document_number: true,
          },
        },
        addresses_orders_shipping_address_idToaddresses: {
          select: {
            address_line1: true,
            address_line2: true,
            city: true,
            state_province: true,
            country_code: true,
            postal_code: true,
            // Captured by the checkout map-picker; copied into the snapshot
            // so the carrier route-map can geolocate stops without a
            // geocoding round-trip. See `buildCustomerAddressSnapshot`.
            latitude: true,
            longitude: true,
          },
        },
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_FIND_001);
    }

    // A dispatch note (remisión) only makes sense for orders that are being
    // fulfilled. `processing` is the canonical state (stock reserved, goods
    // ready to leave). `pending_payment` is admitted for the COD shortcut: the
    // courier collects on delivery, so the order may not be paid yet.
    if (order.state !== 'processing' && order.state !== 'pending_payment') {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_STATE_001);
    }

    // Direct-delivery orders hand the goods over immediately at the counter;
    // they do not go through the remisión + recaudo cycle.
    if (order.delivery_type === 'direct_delivery') {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_DELIVERY_001);
    }

    // Delivery address gate: a remisión needs a place to deliver. The address
    // comes from the order's snapshot JSON or its populated shipping-address
    // relation. Without either we cannot generate the remisión.
    const orderShippingRelation =
      order.addresses_orders_shipping_address_idToaddresses;
    const customer_address_snapshot = this.buildCustomerAddressSnapshot(
      order.shipping_address_snapshot,
      orderShippingRelation,
    );
    // Excepción pickup (recogida en tienda): no hay dirección de entrega porque
    // el cliente retira el pedido en el mostrador. La remisión documenta el
    // handover + el registro de seriales, así que NO exigimos dirección. En ese
    // caso customer_address_snapshot queda null y más abajo se persiste como
    // Prisma.JsonNull. Para cualquier otro delivery_type (p.ej. home_delivery)
    // la dirección sigue siendo obligatoria.
    if (
      order.delivery_type !== 'pickup' &&
      !this.snapshotHasAddress(order.shipping_address_snapshot) &&
      !customer_address_snapshot
    ) {
      throw new VendixHttpException(
        ErrorCodes.DISPATCH_NOTE_NO_SHIPPING_ADDRESS,
      );
    }

    const customer_name =
      `${order.users?.first_name || ''} ${order.users?.last_name || ''}`.trim();

    // Resolve the default dispatch location: the active reservation's location
    // for this order, falling back to the store default. Used when an item
    // omits its own location_id.
    const default_location_id = await this.resolveDefaultDispatchLocation(
      store_id,
      order_id,
    );

    // Build items from order items
    const dispatch_items: any[] = [];
    for (const dto_item of dto.items) {
      const order_item = order.order_items.find(
        (oi: any) => oi.id === dto_item.order_item_id,
      );

      if (!order_item) {
        throw new VendixHttpException(ErrorCodes.DSP_ORDER_ITEM_001);
      }

      dispatch_items.push({
        product_id: order_item.product_id,
        product_variant_id: order_item.product_variant_id,
        // Linkage exacto al renglón de la orden (ref 2026-06-25). Lo persiste
        // también el create standalone; aquí faltaba y rompía el cálculo de
        // "cantidad pendiente" por ítem en getByOrder() (riesgo de doble
        // despacho silencioso). La columna sales_order_item_id ya existe.
        sales_order_item_id: order_item.id,
        // Default to the resolved warehouse (reservation/store default) when the
        // item carries no explicit location_id.
        location_id: dto_item.location_id ?? default_location_id,
        ordered_quantity: order_item.quantity,
        dispatched_quantity: dto_item.dispatched_quantity,
        unit_price: order_item.unit_price,
        discount_amount: 0,
        tax_amount: order_item.tax_amount_item || 0,
        total_price:
          Number(order_item.unit_price || 0) * dto_item.dispatched_quantity +
          Number(order_item.tax_amount_item || 0),
        lot_serial: dto_item.lot_serial,
      });
    }

    // Stock gate: the remisión dispatches what is already reserved for this
    // order, so reserved-for-this-order units count as available. Only a real
    // shortfall raises DISPATCH_NOTE_INSUFFICIENT_STOCK.
    await this.validateDispatchItemsStock(store_id, order_id, dispatch_items);

    const subtotal = dispatch_items.reduce(
      (sum, item) =>
        sum + Number(item.unit_price || 0) * item.dispatched_quantity,
      0,
    );
    const total_discount = dispatch_items.reduce(
      (sum, item) => sum + Number(item.discount_amount || 0),
      0,
    );
    const total_tax = dispatch_items.reduce(
      (sum, item) => sum + Number(item.tax_amount || 0),
      0,
    );
    const grand_total = subtotal - total_discount + total_tax;

    // Pending balance on the order means the courier must collect on delivery.
    const needs_collection = Number(order.remaining_balance) > 0;

    // When target_status === 'confirmed' we create the note already in the
    // `confirmed` state (the valid draft -> confirmed transition) and stamp the
    // confirmation audit fields, so the result mirrors what the flow service
    // would produce — without a second round-trip outside the transaction.
    const is_confirmed = target_status === 'confirmed';

    // Everything below is one all-or-nothing transaction.
    const dispatch_note = await this.prisma.$transaction(async (tx) => {
      const dispatch_number =
        await this.dispatchNumberGenerator.generateNextNumber(store_id);

      const created_note = await tx.dispatch_notes.create({
        data: {
          store_id,
          dispatch_number,
          status: is_confirmed
            ? dispatch_note_status_enum.confirmed
            : dispatch_note_status_enum.draft,
          // Bidirectional fields — default to outbound/customer_delivery for
          // backward compat (createFromOrder is the COD shortcut, always outbound).
          direction: (dto.direction as dispatch_note_direction_enum | undefined) ??
            dispatch_note_direction_enum.outbound,
          subtype: (dto.subtype as dispatch_note_subtype_enum | undefined) ??
            dispatch_note_subtype_enum.customer_delivery,
          reason: (dto.reason as dispatch_note_reason_enum | undefined) ?? null,
          customer_id: order.customer_id,
          customer_name,
          customer_tax_id: order.users?.document_number || null,
          // Delivery-address snapshot read by the remisión PDF in cascade.
          customer_address: customer_address_snapshot ?? Prisma.JsonNull,
          order_id,
          needs_collection,
          supplier_id: dto.supplier_id ?? null,
          related_dispatch_id: dto.related_dispatch_id ?? null,
          from_location_id: dto.from_location_id ?? null,
          to_location_id: dto.to_location_id ?? null,
          // Surface the resolved warehouse on the remisión so the frontend can
          // display it (reservation location → store default fallback).
          dispatch_location_id: dto.dispatch_location_id ?? default_location_id,
          emission_date: new Date(),
          agreed_delivery_date: dto.agreed_delivery_date
            ? new Date(dto.agreed_delivery_date)
            : null,
          subtotal_amount: subtotal,
          discount_amount: total_discount,
          tax_amount: total_tax,
          grand_total,
          currency: order.currency || 'COP',
          notes: dto.notes,
          created_by_user_id: user_id,
          ...(is_confirmed && {
            confirmed_by_user_id: user_id,
            confirmed_at: new Date(),
          }),
          updated_at: new Date(),
          dispatch_note_items: {
            create: dispatch_items,
          },
        },
        include: DISPATCH_NOTE_INCLUDE,
      });

      // ── Route assignment (optional) ──────────────────────────────────────
      if (assignment_mode === 'existing') {
        await this.attachToExistingRoute(
          tx,
          store_id,
          dto.route_assignment!.route_id!,
          created_note.id,
        );
      } else if (assignment_mode === 'new') {
        await this.createRouteWithFirstStop(
          tx,
          store_id,
          user_id,
          dto.route_assignment!.new_route!,
          created_note.id,
        );
      }

      return created_note;
    });

    // POST-COMMIT side effects. The confirmed event triggers the stock
    // listener; its double-stock guard keys off `order_id`, so order-linked
    // notes (like this one) do NOT re-reserve stock.
    if (is_confirmed) {
      this.eventEmitter.emit('dispatch_note.confirmed', {
        dispatch_note_id: dispatch_note.id,
        dispatch_number: dispatch_note.dispatch_number,
        store_id: dispatch_note.store_id,
        sales_order_id: dispatch_note.sales_order_id,
        order_id: dispatch_note.order_id,
      });
    }

    // Bug C — recompute orders.dispatch_fulfillment inline. The DEFAULT 'draft'
    // path emits NO event, yet its non-voided draft note already counts in the
    // rollup (status <> 'voided'), so the column must be refreshed here or the
    // order keeps showing as despachable. Awaited so the value is fresh the
    // moment this call returns (the confirmed path also fires the event listener
    // — the recompute is idempotent, so the overlap is harmless). Isolated: a
    // failure must not fail an already-committed remisión.
    if (dispatch_note.order_id) {
      try {
        await this.dispatchFulfillment.recomputeOrderFulfillment(
          dispatch_note.order_id,
          dispatch_note.store_id,
        );
      } catch (err: any) {
        this.logger.error(
          `[createFromOrder] Failed to recompute dispatch_fulfillment for order #${dispatch_note.order_id}: ${err?.message}`,
        );
      }
    }

    return dispatch_note;
  }

  /**
   * Plan Despacho Economía — FASE 7 paso 23.
   * Crea remisiones en lote a partir de múltiples órdenes con resultado
   * parcial por orden.
   *
   * - `atomic=false` (default): cada orden se procesa independientemente;
   *   las válidas se crean y las inválidas se reportan con código.
   * - `atomic=true`: rollback total si cualquier orden falla.
   * - Idempotencia: `batch_key` deduplica reintentos (búsqueda por notes JSON
   *   que contiene el batch_key; sin tabla adicional en v1).
   */
  async createFromOrdersBatch(dto: CreateFromOrdersBatchDto): Promise<{
    results: Array<
      | { status: 'created'; order_id: number; dispatch_note_id: number; dispatch_number: string }
      | { status: 'failed'; order_id: number; error_code: string; message: string }
      | { status: 'skipped'; order_id: number; reason: string }
    >;
    route_id?: number | null;
    partial: boolean;
  }> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    if (!dto.orders || dto.orders.length === 0) {
      throw new BadRequestException('DSP_BATCH_EMPTY_001: orders[] no puede estar vacío');
    }
    if (dto.orders.length > 100) {
      throw new BadRequestException('DSP_BATCH_TOO_LARGE_001: máximo 100 órdenes por batch');
    }

    const atomic = dto.atomic ?? false;
    const batch_key = dto.batch_key ?? null;
    const results: Array<any> = [];

    if (batch_key) {
      const existing = await this.prisma.dispatch_notes.findFirst({
        where: {
          store_id,
          notes: { contains: `"batch_key":"${batch_key}"` },
        },
        select: { id: true, dispatch_number: true, order_id: true },
      });
      if (existing) {
        return {
          results: dto.orders.map((oid) => ({
            status: 'skipped' as const,
            order_id: oid,
            reason: `batch_key ya aplicado (note #${existing.id})`,
          })),
          route_id: null,
          partial: false,
        };
      }
    }

    if (atomic) {
      try {
        await this.prisma.$transaction(async () => {
          for (const oid of dto.orders) {
            try {
              const note = await this.createFromOrder(oid, {
                target_status: dto.target_status ?? 'confirmed',
                items: dto.items_by_order?.[oid],
                route_assignment: dto.route_assignment,
              } as any);
              results.push({
                status: 'created',
                order_id: oid,
                dispatch_note_id: note.id,
                dispatch_number: note.dispatch_number,
              });
            } catch (e: any) {
              throw new BadRequestException(
                `atomic-batch abort en orden ${oid}: ${e?.message ?? e}`,
              );
            }
          }
        });
        return { results, route_id: null, partial: false };
      } catch (err: any) {
        throw new BadRequestException(
          `atomic-batch failed: ${err?.message ?? err}`,
        );
      }
    }

    let partial = false;
    for (const oid of dto.orders) {
      try {
        const note = await this.createFromOrder(oid, {
          target_status: dto.target_status ?? 'confirmed',
          items: dto.items_by_order?.[oid],
          route_assignment: dto.route_assignment,
        } as any);
        results.push({
          status: 'created',
          order_id: oid,
          dispatch_note_id: note.id,
          dispatch_number: note.dispatch_number,
        });
      } catch (e: any) {
        partial = true;
        results.push({
          status: 'failed',
          order_id: oid,
          error_code: e?.code ?? 'DSP_BATCH_ORDER_FAIL',
          message: e?.message ?? String(e),
        });
      }
    }

    return { results, route_id: null, partial };
  }

  /**
   * Validación en lote (sin crear): agrega stock disponible vs pendiente
   * por SKU en 2 consultas agregadas (no N×M).
   * Plan Despacho Economía — FASE 7 paso 23.
   */
  async validateFromOrdersBatch(order_ids: number[]): Promise<{
    ok: boolean;
    issues: Array<{
      order_id: number;
      product_id: number;
      missing_units: number;
      reason: 'no_stock' | 'no_location';
    }>;
  }> {
    const orders = await this.prisma.orders.findMany({
      where: { id: { in: order_ids } },
      select: {
        id: true,
        order_items: { select: { product_id: true, quantity: true } },
      },
    });

    // 2 agregaciones totales por SKU: sum(stock) - sum(reserved)
    const all_product_ids = Array.from(
      new Set(
        orders.flatMap((o) =>
          (o.order_items ?? []).map((l) => l.product_id),
        ),
      ),
    );

    const stock_aggregate =
      all_product_ids.length === 0
        ? []
        : await this.prisma.stock_levels.groupBy({
            by: ['product_id'],
            where: { product_id: { in: all_product_ids } },
            _sum: { quantity: true, reserved_quantity: true },
          });
    const available_by_product = new Map<number, number>();
    for (const row of stock_aggregate) {
      const q = Number(row._sum.quantity || 0);
      const r = Number(row._sum.reserved_quantity || 0);
      available_by_product.set(Number(row.product_id), q - r);
    }

    const issues: Array<any> = [];
    for (const o of orders) {
      for (const line of o.order_items ?? []) {
        const available = available_by_product.get(Number(line.product_id)) ?? 0;
        const need = Number(line.quantity);
        if (available < need) {
          issues.push({
            order_id: o.id,
            product_id: Number(line.product_id),
            missing_units: need - available,
            reason: 'no_stock' as const,
          });
        }
      }
    }
    return { ok: issues.length === 0, issues };
  }

  /**
   * Normalize a Prisma dispatch-note row into the pure calculator input shape.
   * `grand_total` is a Prisma `Decimal`; the calculators expect
   * number/string/null, so we coerce it to a number here.
   */
  private toRouteStopNoteInput(row: {
    id: number;
    grand_total: Prisma.Decimal | number | string | null;
    needs_collection: boolean | null;
    invoice?: { payment_date: Date | null } | null;
    order?: { remaining_balance: Prisma.Decimal | number | string | null } | null;
  }): RouteStopNoteInput {
    return {
      id: row.id,
      grand_total: row.grand_total == null ? null : Number(row.grand_total),
      needs_collection: row.needs_collection,
      invoice: row.invoice ?? null,
      // Live payment state of a regular order → DERIVED prepaid resolution.
      order:
        row.order == null
          ? null
          : {
              remaining_balance:
                row.order.remaining_balance == null
                  ? null
                  : Number(row.order.remaining_balance),
            },
    };
  }

  /**
   * Attach a freshly created dispatch note as a new stop on an EXISTING route,
   * inside the caller's transaction. Validates the route is store-scoped and in
   * an editable state, that the note is not already on a route, appends the
   * stop at `max(stop_sequence) + 1`, and recomputes the route totals over the
   * complete set of stops using the pure route-stop calculators.
   */
  private async attachToExistingRoute(
    tx: Prisma.TransactionClient,
    store_id: number,
    route_id: number,
    dispatch_note_id: number,
  ): Promise<void> {
    // dispatch_routes is NOT auto-scoped by StorePrismaService, so we filter
    // store_id explicitly (mirrors DispatchRoutesService.findOne).
    const route = await tx.dispatch_routes.findFirst({
      where: { id: route_id, store_id },
      include: {
        stops: {
          select: {
            dispatch_note_id: true,
            stop_sequence: true,
            is_prepaid: true,
          },
        },
      },
    });
    if (!route) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_NOT_EDITABLE_001);
    }

    // State gate: only "hot" routes (draft / dispatched) accept new stops.
    // Vendix Repartos (B7): las rutas CARRIER admiten además `in_transit`
    // (tomar-en-recorrido: el repartidor reclama otra orden mientras ya está en
    // ruta). Las rutas admin conservan el gate original (draft/dispatched).
    const EDITABLE_STATES: dispatch_route_status_enum[] = route.is_carrier_route
      ? ['draft', 'dispatched', 'in_transit']
      : ['draft', 'dispatched'];
    if (!EDITABLE_STATES.includes(route.status)) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_NOT_EDITABLE_001);
    }

    // The note was just created so it cannot be on a route yet, but the global
    // unique on dispatch_note_id makes this explicit and future-proof.
    const already_on_route = await tx.dispatch_route_stops.findFirst({
      where: { dispatch_note_id },
      select: { id: true },
    });
    if (already_on_route) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_STOP_CONFLICT_001);
    }

    // Load the new note with the SAME select shape the calculators expect.
    // invoice.payment_date + order.remaining_balance feed the DERIVED prepaid.
    const new_note = await tx.dispatch_notes.findFirst({
      where: { id: dispatch_note_id, store_id },
      select: {
        id: true,
        grand_total: true,
        needs_collection: true,
        invoice: { select: { payment_date: true } },
        order: { select: { remaining_balance: true } },
      },
    });
    if (!new_note) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_STOP_CONFLICT_001);
    }

    const next_sequence =
      route.stops.reduce((max, s) => Math.max(max, s.stop_sequence ?? 0), 0) + 1;

    const new_stop_input: RouteStopSequenceInput = {
      dispatch_note_id,
      stop_sequence: next_sequence,
    };
    const new_note_input = this.toRouteStopNoteInput(new_note);
    const new_notes_by_id: ReadonlyMap<number, RouteStopNoteInput> = new Map([
      [new_note_input.id, new_note_input],
    ]);
    const [new_stop_data] = buildStopsData([new_stop_input], new_notes_by_id);

    // Recompute totals over the COMPLETE set (existing + new). is_prepaid is
    // DERIVED from each note's live payment state, not the frozen persisted
    // stop boolean — consistent with the read-path derivation.
    const existing_note_ids = route.stops.map((s) => s.dispatch_note_id);
    const existing_notes_full = await tx.dispatch_notes.findMany({
      where: { id: { in: existing_note_ids }, store_id },
      select: {
        id: true,
        grand_total: true,
        needs_collection: true,
        invoice: { select: { payment_date: true } },
        order: { select: { remaining_balance: true } },
      },
    });
    const all_notes_by_id = new Map<number, RouteStopNoteInput>([
      [new_note_input.id, new_note_input],
    ]);
    for (const n of existing_notes_full)
      all_notes_by_id.set(n.id, this.toRouteStopNoteInput(n));

    const all_stops_data = [
      ...route.stops.map((s) => {
        const note = all_notes_by_id.get(s.dispatch_note_id);
        return {
          dispatch_note_id: s.dispatch_note_id,
          stop_sequence: s.stop_sequence,
          is_extra_route: false,
          is_prepaid: note ? resolveIsPrepaid(note) : s.is_prepaid,
          collected_amount: 0,
          anticipo_amount: 0,
          change_amount: 0,
          withholding_amount: 0,
          credit_amount: 0,
          notes: null,
        };
      }),
      new_stop_data,
    ];
    const { total_to_collect, total_prepaid } = computeRouteTotals(
      all_stops_data,
      all_notes_by_id,
    );

    await tx.dispatch_route_stops.create({
      data: { ...new_stop_data, route_id },
    });
    await tx.dispatch_routes.update({
      where: { id: route_id },
      data: { total_to_collect, total_prepaid, updated_at: new Date() },
    });
  }

  /**
   * Create a brand-new route (planilla) inside the caller's transaction, with
   * the freshly created dispatch note as its FIRST stop. Mirrors
   * DispatchRoutesService.create(): generates the route number with the shared
   * generator (retrying on the unique collision), maps `assistant_ids` to the
   * JSON `assistants` shape, and computes totals via the pure calculators.
   */
  private async createRouteWithFirstStop(
    tx: Prisma.TransactionClient,
    store_id: number,
    user_id: number | undefined,
    new_route: NonNullable<CreateFromOrderDto['route_assignment']>['new_route'],
    dispatch_note_id: number,
  ): Promise<void> {
    if (!new_route) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_ASSIGN_001);
    }

    // Validate vehicle belongs to the store, when provided.
    if (new_route.vehicle_id) {
      const vehicle = await tx.vehicles.findFirst({
        where: { id: new_route.vehicle_id, store_id },
        select: { id: true },
      });
      if (!vehicle) {
        throw new VendixHttpException(ErrorCodes.DSP_ROUTE_ASSIGN_001);
      }
    }

    // Map the flat assistant_ids into the JSON `assistants` shape the table
    // stores ({ user_id }[]), matching DispatchRoutesService.create().
    const assistants = (new_route.assistant_ids ?? []).map((id) => ({
      user_id: id,
    }));

    // Load the note for prepaid/total resolution (calculator input shape).
    // invoice.payment_date + order.remaining_balance feed the DERIVED prepaid.
    const note = await tx.dispatch_notes.findFirst({
      where: { id: dispatch_note_id, store_id },
      select: {
        id: true,
        grand_total: true,
        needs_collection: true,
        invoice: { select: { payment_date: true } },
        order: { select: { remaining_balance: true } },
      },
    });
    if (!note) {
      throw new VendixHttpException(ErrorCodes.DSP_ROUTE_STOP_CONFLICT_001);
    }

    const note_input = this.toRouteStopNoteInput(note);
    const notes_by_id: ReadonlyMap<number, RouteStopNoteInput> = new Map([
      [note_input.id, note_input],
    ]);
    const stops_data = buildStopsData(
      [{ dispatch_note_id, stop_sequence: 1 }],
      notes_by_id,
    );
    const { total_to_collect, total_prepaid } = computeRouteTotals(
      stops_data,
      notes_by_id,
    );

    let attempts = 0;
    while (true) {
      try {
        const route_number =
          await this.routeNumberGenerator.generateNextNumber(store_id);
        await tx.dispatch_routes.create({
          data: {
            store_id,
            route_number,
            route_code: new_route.route_code,
            status: 'draft',
            vehicle_id: new_route.vehicle_id,
            driver_user_id: new_route.driver_user_id,
            external_driver_name: new_route.external_driver_name,
            external_driver_id_number: new_route.external_driver_id_number,
            is_primary_driver_external:
              new_route.is_primary_driver_external ?? false,
            assistants: assistants as Prisma.InputJsonValue,
            origin_location_id: new_route.origin_location_id,
            planned_date: new Date(new_route.planned_date),
            currency: new_route.currency || 'COP',
            notes: new_route.notes,
            total_to_collect,
            total_prepaid,
            created_by_user_id: user_id,
            updated_at: new Date(),
            stops: {
              create: stops_data,
            },
          },
        });
        return;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          (error.meta?.target as string[])?.includes('route_number')
        ) {
          attempts++;
          if (attempts >= 3) {
            throw new ConflictException(
              'No se pudo generar un número de planilla único',
            );
          }
          continue;
        }
        throw error;
      }
    }
  }

  async findAll(query: DispatchNoteQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      customer_id,
      sales_order_id,
      date_from,
      date_to,
      sort_by,
      sort_order,
      direction,
      subtype,
      reason,
      supplier_id,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.dispatch_notesWhereInput = {
      ...(search && {
        OR: [
          { dispatch_number: { contains: search, mode: 'insensitive' as any } },
          { customer_name: { contains: search, mode: 'insensitive' as any } },
        ],
      }),
      ...(status && { status }),
      ...(customer_id && { customer_id }),
      ...(sales_order_id && { sales_order_id }),
      ...(direction && { direction }),
      ...(subtype && { subtype }),
      ...(reason && { reason }),
      ...(supplier_id && { supplier_id }),
      ...(date_from &&
        date_to && {
          created_at: {
            gte: new Date(date_from),
            lte: new Date(date_to),
          },
        }),
    };

    const orderBy: any = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [data, total] = await Promise.all([
      this.prisma.dispatch_notes.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          dispatch_note_items: {
            select: {
              id: true,
              product_id: true,
              dispatched_quantity: true,
            },
          },
          customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          // Reverse relation so the list view can show which planilla
          // the remisión is currently assigned to (or '—' if unassigned).
          dispatch_route_stops: {
            orderBy: { id: 'desc' as const },
            select: {
              id: true,
              route_id: true,
              stop_sequence: true,
              status: true,
              result: true,
              route: {
                select: {
                  id: true,
                  route_number: true,
                  route_code: true,
                  status: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.dispatch_notes.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const dispatch_note = await this.prisma.dispatch_notes.findFirst({
      where: { id },
      include: DISPATCH_NOTE_INCLUDE,
    });

    if (!dispatch_note) {
      throw new NotFoundException('Remisión no encontrada');
    }

    return dispatch_note;
  }

  async update(id: number, dto: UpdateDispatchNoteDto) {
    const dispatch_note = await this.findOne(id);

    if (dispatch_note.status !== dispatch_note_status_enum.draft) {
      throw new BadRequestException(
        'Solo se pueden editar remisiones en estado borrador',
      );
    }

    // If items are provided, delete and recreate
    if (dto.items) {
      return this.prisma.$transaction(async (tx) => {
        await tx.dispatch_note_items.deleteMany({
          where: { dispatch_note_id: id },
        });

        const items = dto.items!;
        const subtotal = items.reduce(
          (sum, item) =>
            sum + Number(item.unit_price || 0) * item.dispatched_quantity,
          0,
        );
        const total_discount = items.reduce(
          (sum, item) => sum + Number(item.discount_amount || 0),
          0,
        );
        const total_tax = items.reduce(
          (sum, item) => sum + Number(item.tax_amount || 0),
          0,
        );
        const grand_total = subtotal - total_discount + total_tax;

        // Denormalize customer if changed
        let customer_data: any = {};
        if (dto.customer_id && dto.customer_id !== dispatch_note.customer_id) {
          const customer = await tx.users.findUnique({
            where: { id: dto.customer_id },
            select: {
              first_name: true,
              last_name: true,
              document_number: true,
            },
          });
          if (customer) {
            customer_data = {
              customer_name:
                `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
              customer_tax_id: customer.document_number || null,
            };
          }
        }

        return tx.dispatch_notes.update({
          where: { id },
          data: {
            customer_id: dto.customer_id ?? dispatch_note.customer_id,
            sales_order_id: dto.sales_order_id ?? dispatch_note.sales_order_id,
            dispatch_location_id:
              dto.dispatch_location_id ?? dispatch_note.dispatch_location_id,
            emission_date: dto.emission_date
              ? new Date(dto.emission_date)
              : dispatch_note.emission_date,
            agreed_delivery_date: dto.agreed_delivery_date
              ? new Date(dto.agreed_delivery_date)
              : dispatch_note.agreed_delivery_date,
            notes: dto.notes ?? dispatch_note.notes,
            internal_notes: dto.internal_notes ?? dispatch_note.internal_notes,
            currency: dto.currency ?? dispatch_note.currency,
            subtotal_amount: subtotal,
            discount_amount: total_discount,
            tax_amount: total_tax,
            grand_total,
            ...customer_data,
            updated_at: new Date(),
            dispatch_note_items: {
              create: items.map((item) => ({
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                location_id: item.location_id,
                ordered_quantity: item.ordered_quantity,
                dispatched_quantity: item.dispatched_quantity,
                unit_price: item.unit_price,
                discount_amount: item.discount_amount || 0,
                tax_amount: item.tax_amount || 0,
                total_price:
                  Number(item.unit_price || 0) * item.dispatched_quantity -
                  Number(item.discount_amount || 0) +
                  Number(item.tax_amount || 0),
                lot_serial: item.lot_serial,
                sales_order_item_id: item.sales_order_item_id,
              })),
            },
          },
          include: DISPATCH_NOTE_INCLUDE,
        });
      });
    }

    // Update without items
    const { items: _items, ...update_data } = dto as any;

    // Denormalize customer if changed
    let customer_data: any = {};
    if (dto.customer_id && dto.customer_id !== dispatch_note.customer_id) {
      const customer = await this.prisma.users.findUnique({
        where: { id: dto.customer_id },
        select: { first_name: true, last_name: true, document_number: true },
      });
      if (customer) {
        customer_data = {
          customer_name:
            `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
          customer_tax_id: customer.document_number || null,
        };
      }
    }

    return this.prisma.dispatch_notes.update({
      where: { id },
      data: {
        ...update_data,
        ...customer_data,
        emission_date: update_data.emission_date
          ? new Date(update_data.emission_date)
          : undefined,
        agreed_delivery_date: update_data.agreed_delivery_date
          ? new Date(update_data.agreed_delivery_date)
          : undefined,
        updated_at: new Date(),
      },
      include: DISPATCH_NOTE_INCLUDE,
    });
  }

  async remove(id: number) {
    const dispatch_note = await this.findOne(id);

    if (dispatch_note.status !== dispatch_note_status_enum.draft) {
      throw new BadRequestException(
        'Solo se pueden eliminar remisiones en estado borrador',
      );
    }

    return this.prisma.dispatch_notes.delete({ where: { id } });
  }

  async getStats() {
    const [
      total,
      draft,
      confirmed,
      delivered,
      received,
      invoiced,
      voided,
      total_value,
      outboundCount,
      inboundCount,
      bySubtypeAgg,
    ] = await Promise.all([
      this.prisma.dispatch_notes.count(),
      this.prisma.dispatch_notes.count({ where: { status: 'draft' } }),
      this.prisma.dispatch_notes.count({ where: { status: 'confirmed' } }),
      this.prisma.dispatch_notes.count({ where: { status: 'delivered' } }),
      this.prisma.dispatch_notes.count({ where: { status: 'received' } }),
      this.prisma.dispatch_notes.count({ where: { status: 'invoiced' } }),
      this.prisma.dispatch_notes.count({ where: { status: 'voided' } }),
      this.prisma.dispatch_notes.aggregate({
        _sum: { grand_total: true },
        where: { status: { not: 'voided' } },
      }),
      this.prisma.dispatch_notes.count({ where: { direction: 'outbound' } }),
      this.prisma.dispatch_notes.count({ where: { direction: 'inbound' } }),
      this.prisma.dispatch_notes.groupBy({
        by: ['subtype'],
        _count: { id: true },
      }),
    ]);

    const pending_invoicing = delivered;
    const average_value =
      total > 0 ? Number(total_value._sum.grand_total || 0) / total : 0;

    // Build by_subtype map from the groupBy result.
    const by_subtype: Record<string, number> = {};
    for (const group of bySubtypeAgg) {
      by_subtype[group.subtype] = group._count.id;
    }

    return {
      total,
      draft,
      confirmed,
      delivered,
      received,
      invoiced,
      voided,
      pending_invoicing,
      average_value: Math.round(average_value * 100) / 100,
      by_direction: {
        outbound: outboundCount,
        inbound: inboundCount,
      },
      by_subtype,
    };
  }

  async getBySalesOrder(sales_order_id: number) {
    const dispatch_notes = await this.prisma.dispatch_notes.findMany({
      where: { sales_order_id },
      orderBy: { created_at: 'desc' },
      include: {
        dispatch_note_items: {
          select: {
            id: true,
            product_id: true,
            dispatched_quantity: true,
            sales_order_item_id: true,
          },
        },
      },
    });

    return dispatch_notes;
  }

  /**
   * Vendix Repartos — Fase B5. Publica una orden al pool de repartidores.
   *
   * Valida la orden (store-scoped) y la marca como disponible poniendo
   * `dispatch_pool_at = now()` de forma IDEMPOTENTE (guard `dispatch_pool_at
   * IS NULL`): si ya estaba en el pool, devuelve el estado actual sin error y
   * sin re-notificar. En la transición real emite `order.awaiting_carrier`
   * ({ order_id, store_id }) para que el listener notifique a los carriers.
   *
   * Reglas de dominio (reusan los códigos DSP_ORDER_* del flujo createFromOrder):
   * - state ∈ {processing, pending_payment}
   * - delivery_type != 'direct_delivery'
   * - dispatch_fulfillment != 'full'
   * - sin remisión ACTIVA (dispatch_notes no anuladas) → evita doble despacho.
   */
  async sendToDispatchPool(order_id: number) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // orders es auto-scoped por StorePrismaService → findFirst basta.
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      select: {
        id: true,
        state: true,
        delivery_type: true,
        dispatch_fulfillment: true,
        dispatch_pool_at: true,
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_FIND_001);
    }

    // Sólo órdenes en curso de fulfillment pueden ir al pool. `processing`
    // (stock reservado) y `pending_payment` (COD, se cobra al entregar).
    if (order.state !== 'processing' && order.state !== 'pending_payment') {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_STATE_001);
    }

    // Envío directo se entrega en el mostrador; no pasa por el ciclo remisión.
    if (order.delivery_type === 'direct_delivery') {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_DELIVERY_001);
    }

    // Ya despachada completamente → no tiene sentido enviarla al pool.
    if (order.dispatch_fulfillment === 'full') {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_STATE_001);
    }

    // Rechazo si la orden ya tiene una remisión ACTIVA (no anulada): evita
    // que un admin la mande al pool mientras otro flujo ya la está despachando.
    const activeNotes = await this.prisma.dispatch_notes.count({
      where: { order_id, status: { not: 'voided' } },
    });
    if (activeNotes > 0) {
      throw new VendixHttpException(ErrorCodes.DSP_ORDER_STATE_001);
    }

    // Inserción idempotente en el pool: sólo si aún no está pooleada.
    const now = new Date();
    const updated = await this.prisma.orders.updateMany({
      where: { id: order_id, store_id, dispatch_pool_at: null },
      data: { dispatch_pool_at: now },
    });

    let pooled_at = now;
    if (updated.count === 0) {
      // Ya estaba en el pool → devolvemos el estado actual sin re-notificar.
      const existing = await this.prisma.orders.findFirst({
        where: { id: order_id },
        select: { dispatch_pool_at: true },
      });
      pooled_at = existing?.dispatch_pool_at ?? now;
    } else {
      // Transición real → notificar a los carriers de la tienda.
      this.eventEmitter.emit('order.awaiting_carrier', {
        order_id,
        store_id,
      });
    }

    return { order_id, pooled_at: pooled_at.toISOString() };
  }

  async getByOrder(order_id: number) {
    const dispatch_notes = await this.prisma.dispatch_notes.findMany({
      // Excluye remisiones anuladas: no consumen el pendiente por ítem
      // (ref 2026-06-25, cálculo de cantidad pendiente en el wizard).
      where: { order_id, status: { not: 'voided' } },
      orderBy: { created_at: 'desc' },
      include: {
        dispatch_note_items: {
          select: {
            id: true,
            product_id: true,
            product_variant_id: true,
            // Enlace exacto al renglón de la orden — necesario para descontar
            // el pendiente por ítem en order-items-step (ref 2026-06-25).
            sales_order_item_id: true,
            dispatched_quantity: true,
          },
        },
      },
    });

    return dispatch_notes;
  }

  async getPendingInvoicing(query: DispatchNoteQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const where: any = {
      store_id,
      status: 'delivered',
    };

    if (query.customer_id) where.customer_id = Number(query.customer_id);
    if (query.date_from)
      where.emission_date = {
        ...(where.emission_date || {}),
        gte: new Date(query.date_from),
      };
    if (query.date_to)
      where.emission_date = {
        ...(where.emission_date || {}),
        lte: new Date(query.date_to),
      };

    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);

    const [data, total] = await Promise.all([
      this.prisma.dispatch_notes.findMany({
        where,
        include: {
          customer: { select: { id: true, first_name: true, last_name: true } },
          dispatch_note_items: true,
        },
        orderBy: { emission_date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispatch_notes.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getByCustomerReport(query: DispatchNoteQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const where: any = { store_id };

    if (query.customer_id) where.customer_id = Number(query.customer_id);
    if (query.status) where.status = query.status;
    if (query.date_from)
      where.emission_date = {
        ...(where.emission_date || {}),
        gte: new Date(query.date_from),
      };
    if (query.date_to)
      where.emission_date = {
        ...(where.emission_date || {}),
        lte: new Date(query.date_to),
      };
    if (query.search) {
      where.OR = [
        { dispatch_number: { contains: query.search, mode: 'insensitive' } },
        { customer_name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);

    const [data, total] = await Promise.all([
      this.prisma.dispatch_notes.findMany({
        where,
        include: {
          customer: { select: { id: true, first_name: true, last_name: true } },
          dispatch_note_items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
        },
        orderBy: { emission_date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispatch_notes.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getProfitabilityReport(query: DispatchNoteQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const where: any = {
      store_id,
      status: { in: ['delivered', 'invoiced'] },
    };

    if (query.customer_id) where.customer_id = Number(query.customer_id);
    if (query.date_from)
      where.emission_date = {
        ...(where.emission_date || {}),
        gte: new Date(query.date_from),
      };
    if (query.date_to)
      where.emission_date = {
        ...(where.emission_date || {}),
        lte: new Date(query.date_to),
      };

    const dispatch_notes = await this.prisma.dispatch_notes.findMany({
      where,
      include: {
        dispatch_note_items: true,
        invoice: {
          select: {
            id: true,
            invoice_number: true,
            total_amount: true,
            status: true,
          },
        },
      },
      orderBy: { emission_date: 'desc' },
    });

    const summary = {
      total_dispatched: dispatch_notes.reduce(
        (sum, dn) => sum + Number(dn.grand_total),
        0,
      ),
      total_invoiced: dispatch_notes
        .filter((dn) => dn.invoice)
        .reduce((sum, dn) => sum + Number(dn.invoice?.total_amount || 0), 0),
      gap: 0,
      dispatch_notes_count: dispatch_notes.length,
      invoiced_count: dispatch_notes.filter((dn) => dn.status === 'invoiced')
        .length,
      pending_count: dispatch_notes.filter((dn) => dn.status === 'delivered')
        .length,
    };
    summary.gap = summary.total_dispatched - summary.total_invoiced;

    return { summary, dispatch_notes };
  }
}
