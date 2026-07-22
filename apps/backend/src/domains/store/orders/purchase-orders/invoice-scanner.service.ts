import { Injectable, Logger } from '@nestjs/common';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { SettingsService } from '../../settings/settings.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  SupplierMatch,
  MatchedLineItem,
  ProductCandidate,
  ConfirmScannedInvoiceDto,
} from './dto/scan-invoice.dto';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderItemDto,
} from './dto/create-purchase-order.dto';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import sharp = require('sharp');

@Injectable()
export class InvoiceScannerService {
  private readonly logger = new Logger(InvoiceScannerService.name);

  /**
   * F3 IVA lifecycle — RUT casilla 53 code for "Responsable de IVA" (O-48).
   * Mirrors PurchaseOrdersService.VAT_RESPONSIBLE_CODE so the tax-category
   * suggestion uses the same canonical fiscal source.
   */
  private static readonly VAT_RESPONSIBLE_CODE = 'O-48';

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly settingsService: SettingsService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Fase 4: `orderType` selects the AI application key. Defaults to
   * `retail` (the original `invoice_ocr`). When the user is scanning an
   * ingredient order, callers should pass `orderType: 'ingredient'`
   * and we route to `invoice_ocr_ingredient` so the model also extracts
   * `presentation` / `pack_size` / `uom_hint`.
   *
   * Mixed-line orders are out of scope (V1): the caller picks one profile
   * per scan.
   */
  async scanInvoice(
    file: Express.Multer.File,
    orderType: 'retail' | 'ingredient' = 'retail',
  ): Promise<InvoiceScanResult> {
    this.logger.debug(
      `[InvoiceScan] File: mimetype=${file.mimetype}, size=${file.size}, buffer=${file.buffer?.length ?? 'NO BUFFER'}`,
    );

    const { base64, mimeType } = await this.preprocessImage(file);
    const dataUri = `data:${mimeType};base64,${base64}`;

    this.logger.debug(`[InvoiceScan] DataURI length: ${dataUri.length} chars`);

    const imageMessage: AIMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract all data from this purchase invoice image. Return ONLY the JSON object matching the schema defined in your system instructions.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    const appKey =
      orderType === 'ingredient' ? 'invoice_ocr_ingredient' : 'invoice_ocr';
    this.logger.debug(
      `[InvoiceScan] Sending to AI engine (profile=${orderType}, appKey=${appKey})...`,
    );
    const response = await this.aiEngine.run(appKey, {}, [imageMessage]);

    this.logger.debug(
      `[InvoiceScan] AI response: success=${response.success}, contentLength=${response.content?.length ?? 0}, model=${response.model}, error=${response.error}`,
    );
    this.logger.debug(
      `[InvoiceScan] AI content preview: ${response.content?.substring(0, 300)}`,
    );

    if (!response.success || !response.content) {
      this.logger.error(`AI OCR failed: ${response.error}`);
      throw new VendixHttpException(ErrorCodes.INV_SCAN_AI_FAIL);
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
      return this.normalizeOcrResponse(parsed);
    } catch {
      this.logger.error(`Failed to parse AI OCR response: ${response.content}`);
      throw new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL);
    }
  }

  async matchProducts(
    scanResult: InvoiceScanResult,
  ): Promise<InvoiceMatchResult> {
    const warnings: string[] = [];
    let supplierMatch: SupplierMatch;

    // F3 IVA lifecycle: resolve the commerce's VAT responsibility ONCE. A
    // non-responsible tenant (O-49) capitalizes IVA into cost and must not be
    // handed a deductible tax_category, so we skip loading rates entirely and
    // every `suggested_tax_category_id` stays null.
    const vatResponsible = await this.isVatResponsible();
    const taxCategoryRates = vatResponsible
      ? await this.loadTaxCategoryRates()
      : [];

    // Supplier match — never throw
    try {
      supplierMatch = await this.matchSupplier(scanResult);
      if (supplierMatch.is_new) {
        warnings.push(
          `Proveedor "${scanResult.supplier?.name || 'Desconocido'}" no encontrado en el sistema. Puedes seleccionarlo manualmente.`,
        );
      }
    } catch (err) {
      this.logger.warn(`Supplier matching failed: ${err.message}`);
      supplierMatch = {
        name: scanResult.supplier?.name || 'Desconocido',
        confidence: 0,
        is_new: true,
      };
      warnings.push(
        'No se pudo buscar el proveedor. Puedes seleccionarlo manualmente.',
      );
    }

    // Item matching — each item individually wrapped
    const matchedItems: MatchedLineItem[] = [];

    for (const item of scanResult.line_items || []) {
      try {
        const candidates = await this.findProductCandidates(
          item,
          supplierMatch.matched_id,
        );
        const topCandidate = candidates.length > 0 ? candidates[0] : null;

        let matchStatus: 'matched' | 'partial' | 'new' = 'new';
        let selectedProductId: number | undefined;

        if (topCandidate) {
          if (topCandidate.confidence >= 90) {
            matchStatus = 'matched';
            selectedProductId = topCandidate.id;
          } else if (topCandidate.confidence >= 50) {
            matchStatus = 'partial';
            if (topCandidate.confidence >= 80) {
              selectedProductId = topCandidate.id;
            }
          }
        }

        if (matchStatus === 'new') {
          warnings.push(
            `Producto "${item.description}" sin coincidencias en el catálogo.`,
          );
        }

        matchedItems.push({
          ...item,
          match_status: matchStatus,
          selected_product_id: selectedProductId,
          candidates: candidates.slice(0, 5),
          // F3: sugerencia de impuesto por tasa + neto ya aplanado.
          suggested_tax_category_id: this.suggestTaxCategoryId(
            item.tax_rate,
            taxCategoryRates,
          ),
          unit_cost_net: Number(item.unit_price) || 0,
        });
      } catch (err) {
        this.logger.warn(
          `Item matching failed for "${item.description}": ${err.message}`,
        );
        warnings.push(`No se pudo buscar "${item.description}".`);
        matchedItems.push({
          ...item,
          match_status: 'new',
          selected_product_id: undefined,
          candidates: [],
          // F3: mantiene el contrato aun cuando el match de producto falla.
          suggested_tax_category_id: this.suggestTaxCategoryId(
            item.tax_rate,
            taxCategoryRates,
          ),
          unit_cost_net: Number(item.unit_price) || 0,
        });
      }
    }

    return {
      supplier_match: supplierMatch,
      items: matchedItems,
      warnings,
    };
  }

  /** @deprecated Use frontend cart injection instead. Kept for backward compatibility. */
  async confirmAndCreatePO(
    dto: ConfirmScannedInvoiceDto,
    file?: Express.Multer.File,
  ) {
    const items: PurchaseOrderItemDto[] = dto.items.map((item) => {
      const poItem = new PurchaseOrderItemDto();
      if (item.product_id) {
        poItem.product_id = item.product_id;
      } else {
        poItem.product_id = 0;
        poItem.product_name = item.product_name || item.description;
        poItem.sku = item.sku;
      }
      poItem.quantity = item.quantity;
      poItem.unit_price = item.unit_cost;
      poItem.notes = item.description;
      return poItem;
    });

    const createDto = new CreatePurchaseOrderDto();
    createDto.supplier_id = dto.supplier_id ?? 0;
    createDto.location_id = dto.location_id;
    createDto.items = items;
    createDto.notes = dto.notes;
    createDto.tax_amount = dto.tax_amount;
    createDto.discount_amount = dto.discount_amount;

    if (dto.invoice_date) {
      createDto.order_date = dto.invoice_date;
    }

    const po = await this.purchaseOrdersService.create(createDto);

    if (dto.save_attachment && file) {
      const attachmentDto = new AddAttachmentDto();
      attachmentDto.supplier_invoice_number = dto.invoice_number;
      attachmentDto.supplier_invoice_date = dto.invoice_date;
      attachmentDto.notes = 'Factura escaneada con OCR';

      await this.purchaseOrdersService.addAttachment(
        po.id,
        file,
        attachmentDto,
      );
    }

    return po;
  }

  // --- Private helpers ---

  private async matchSupplier(
    scanResult: InvoiceScanResult,
  ): Promise<SupplierMatch> {
    const { supplier } = scanResult;

    try {
      // Tier 1: Match by tax_id (exact, case-insensitive)
      if (supplier.tax_id) {
        const byTax = await this.prisma.suppliers.findFirst({
          where: { tax_id: { equals: supplier.tax_id, mode: 'insensitive' } },
        });
        if (byTax) {
          return {
            matched_id: byTax.id,
            name: byTax.name,
            tax_id: byTax.tax_id,
            confidence: 95,
            is_new: false,
          };
        }
      }

      // Tier 2 & 3: Load suppliers and do bidirectional + word matching
      if (supplier.name) {
        const allSuppliers = await this.prisma.suppliers.findMany({
          select: { id: true, name: true, tax_id: true },
          take: 200,
        });

        const extractedLower = supplier.name.toLowerCase().trim();
        let bestMatch: {
          id: number;
          name: string;
          tax_id: string | null;
        } | null = null;
        let bestScore = 0;

        // Tier 2: Bidirectional contains
        for (const s of allSuppliers) {
          const dbLower = s.name.toLowerCase().trim();
          if (
            dbLower.includes(extractedLower) ||
            extractedLower.includes(dbLower)
          ) {
            const ratio =
              Math.min(extractedLower.length, dbLower.length) /
              Math.max(extractedLower.length, dbLower.length);
            const score = 65 + ratio * 20; // 65-85 range
            if (score > bestScore) {
              bestScore = score;
              bestMatch = s;
            }
          }
        }

        if (bestMatch && bestScore >= 65) {
          return {
            matched_id: bestMatch.id,
            name: bestMatch.name,
            tax_id: bestMatch.tax_id ?? undefined,
            confidence: Math.round(bestScore),
            is_new: false,
          };
        }

        // Tier 3: Word-level overlap
        const extractedWords = extractedLower
          .split(/\s+/)
          .filter((w) => w.length > 2);

        if (extractedWords.length > 0) {
          for (const s of allSuppliers) {
            const dbWords = s.name
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.length > 2);
            if (dbWords.length === 0) continue;

            let matches = 0;
            for (const ew of extractedWords) {
              for (const dw of dbWords) {
                if (dw.includes(ew) || ew.includes(dw)) {
                  matches++;
                  break;
                }
              }
            }

            const score =
              (matches / Math.max(extractedWords.length, dbWords.length)) * 60;
            if (score > bestScore && score >= 30) {
              bestScore = score;
              bestMatch = s;
            }
          }

          if (bestMatch && bestScore >= 30) {
            return {
              matched_id: bestMatch.id,
              name: bestMatch.name,
              tax_id: bestMatch.tax_id ?? undefined,
              confidence: Math.round(bestScore),
              is_new: false,
            };
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Supplier matching failed gracefully: ${err.message}`);
    }

    return {
      name: supplier.name,
      tax_id: supplier.tax_id,
      confidence: 0,
      is_new: true,
    };
  }

  private async findProductCandidates(
    item: { description: string; sku_if_visible?: string },
    supplierId?: number,
  ): Promise<ProductCandidate[]> {
    const candidates: ProductCandidate[] = [];
    const seenIds = new Set<number>();

    // Tier 1: SKU exact match
    if (item.sku_if_visible) {
      const bySku = await this.prisma.products.findFirst({
        where: { sku: { equals: item.sku_if_visible, mode: 'insensitive' } },
        select: { id: true, name: true, sku: true, cost_price: true },
      });
      if (bySku) {
        seenIds.add(bySku.id);
        candidates.push({
          id: bySku.id,
          name: bySku.name,
          sku: bySku.sku || '',
          cost_price: bySku.cost_price ? Number(bySku.cost_price) : undefined,
          confidence: 95,
        });
      }
    }

    // Tier 2: Supplier catalog match
    if (supplierId) {
      const supplierProducts = await this.prisma.supplier_products.findMany({
        where: { supplier_id: supplierId },
        include: {
          products: {
            select: { id: true, name: true, sku: true, cost_price: true },
          },
        },
        take: 20,
      });

      for (const sp of supplierProducts) {
        if (seenIds.has(sp.products.id)) continue;
        const nameScore = this.fuzzyScore(item.description, sp.products.name);
        const skuScore =
          item.sku_if_visible && sp.supplier_sku
            ? sp.supplier_sku.toLowerCase() ===
              item.sku_if_visible.toLowerCase()
              ? 90
              : 0
            : 0;
        const score = Math.max(nameScore + 10, skuScore); // +10 bonus for being in supplier catalog
        if (score >= 30) {
          seenIds.add(sp.products.id);
          candidates.push({
            id: sp.products.id,
            name: sp.products.name,
            sku: sp.products.sku || '',
            cost_price: sp.cost_per_unit ? Number(sp.cost_per_unit) : undefined,
            confidence: Math.min(score, 100),
          });
        }
      }
    }

    // Tier 3: Name-based search in products table
    const keywords = item.description
      .split(/[\s,;.\-\/]+/)
      .filter((w) => w.length > 2)
      .slice(0, 4);

    if (keywords.length > 0) {
      const nameMatches = await this.prisma.products.findMany({
        where: {
          OR: keywords.map((kw) => ({
            name: { contains: kw, mode: 'insensitive' as const },
          })),
          state: { not: 'archived' },
        },
        select: { id: true, name: true, sku: true, cost_price: true },
        take: 10,
      });

      for (const p of nameMatches) {
        if (seenIds.has(p.id)) continue;
        const score = this.fuzzyScore(item.description, p.name);
        if (score >= 25) {
          seenIds.add(p.id);
          candidates.push({
            id: p.id,
            name: p.name,
            sku: p.sku || '',
            cost_price: p.cost_price ? Number(p.cost_price) : undefined,
            confidence: Math.min(score, 100),
          });
        }
      }
    }

    // Sort by confidence descending
    candidates.sort((a, b) => b.confidence - a.confidence);

    return candidates.slice(0, 5);
  }

  private fuzzyScore(query: string, target: string): number {
    const q = query.toLowerCase().trim();
    const t = target.toLowerCase().trim();

    if (q === t) return 100;
    if (t.includes(q) || q.includes(t)) return 85;

    const qWords = q.split(/\s+/).filter((w) => w.length > 2);
    const tWords = t.split(/\s+/).filter((w) => w.length > 2);

    if (qWords.length === 0 || tWords.length === 0) return 0;

    let matches = 0;
    for (const qw of qWords) {
      for (const tw of tWords) {
        if (tw.includes(qw) || qw.includes(tw)) {
          matches++;
          break;
        }
      }
    }

    return Math.round((matches / qWords.length) * 80);
  }

  private async preprocessImage(
    file: Express.Multer.File,
  ): Promise<{ base64: string; mimeType: string }> {
    return this.prepareImage(file);
  }

  /**
   * Public OCR preprocessing — sharp resize to 1536px / q85, returns base64 +
   * dataUri-compatible mimeType. Espejo del patrón `ExpenseScannerService.prepareImage`
   * (vendix-ai-queue v2.2 — el processor async recibe la dataUri, no el buffer).
   */
  async prepareImage(
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

      this.logger.debug(
        `[InvoiceScan] Image preprocessed: ${file.size} bytes → ${processedBuffer.length} bytes (${metadata.width}x${metadata.height}${needsResize ? ' resized' : ''})`,
      );

      return {
        base64: processedBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      };
    } catch (err) {
      this.logger.warn(
        `[InvoiceScan] Image preprocessing failed, using raw: ${err.message}`,
      );
      return {
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
      };
    }
  }

  /**
   * Track B2 — worker-side OCR for payment receipts. Calque de
   * `ExpenseScannerService.scanFromImage`: llama `aiEngine.run()` DIRECTO
   * (NUNCA `runByApplicationType`, que descarta extra_messages en apps image).
   * Devuelve `{amount, payment_date, payment_method, reference, currency,
   * notes, confidence}` parseado de forma defensiva.
   */
  async scanPaymentFromImage(
    dataUri: string,
    _mimeType: string,
  ): Promise<{
    amount: number;
    payment_date: string;
    payment_method: string;
    reference: string | null;
    currency: string | null;
    notes: string | null;
    confidence: number;
  }> {
    const imageMessage: any = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract structured payment-receipt data from this image. Return ONLY the JSON object per the schema in your system prompt.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    const response = await this.aiEngine.run(
      'payment_receipt_ocr',
      {},
      [imageMessage],
    );

    if (!response.success) {
      this.logger.error(
        `[PaymentReceiptScan] aiEngine.run failed: ${response?.error ?? 'unknown'}`,
      );
      throw new Error('AI scan failed');
    }

    let parsed: any;
    const raw = (response as any).content ?? (response as any).text ?? '';
    try {
      const cleaned = String(raw)
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (err: any) {
      this.logger.error(
        `[PaymentReceiptScan] JSON parse failed: ${err?.message} (raw=${String(raw).slice(0, 200)})`,
      );
      throw new Error('OCR parse failed');
    }

    return {
      amount: Number(parsed.amount) || 0,
      payment_date: String(parsed.payment_date ?? ''),
      payment_method: String(parsed.payment_method ?? 'other'),
      reference: parsed.reference ?? null,
      currency: parsed.currency ?? null,
      notes: parsed.notes ?? null,
      confidence: Number(parsed.confidence) || 0,
    };
  }

  private normalizeOcrResponse(parsed: any): InvoiceScanResult {
    if (
      !parsed.supplier ||
      !Array.isArray(parsed.line_items) ||
      parsed.total == null
    ) {
      throw new Error(
        'AI response missing required fields: supplier, line_items, or total',
      );
    }

    // F3 IVA lifecycle: invoice-global include flag. Canonical default is
    // `false` (tax added on top) when the scanner does not emit it, mirroring
    // `effective_include = ... ?? false` in deriveLineTax / recalculateItemTotals.
    const pricesIncludeTax = parsed.prices_include_tax === true;

    return {
      supplier: {
        name: parsed.supplier?.name || 'Desconocido',
        tax_id: parsed.supplier?.tax_id || undefined,
        address: parsed.supplier?.address || undefined,
        phone: parsed.supplier?.phone || undefined,
      },
      invoice_number: String(parsed.invoice_number || ''),
      invoice_date: String(parsed.invoice_date || ''),
      payment_terms: parsed.payment_terms || undefined,
      prices_include_tax: pricesIncludeTax,
      line_items: (parsed.line_items || []).map((item: any) =>
        this.normalizeLineItem(item, pricesIncludeTax),
      ),
      subtotal: Number(parsed.subtotal) || 0,
      tax_amount: Number(parsed.tax_amount) || 0,
      total: Number(parsed.total) || 0,
      confidence: Number(parsed.confidence) || 0,
    };
  }

  /**
   * F3 IVA lifecycle: normalize a single extracted line, flattening its
   * printed unit price to NET when the invoice is IVA-inclusive.
   *
   * Canonical formula (byte-for-byte mirror of PurchaseOrdersService.
   * deriveLineTax): the scanner emits `tax_rate` as a FRACTION (0, 0.05,
   * 0.19) — NOT a percentage — so `r = tax_rate` directly (no /100 here).
   *   include + r>0 → unit_price_net = gross / (1 + r)
   *   otherwise     → unit_price_net = gross (net === printed)
   *
   * `unit_price` is set to the NET; the original printed value is preserved
   * in `unit_price_gross` (equal to net in the exclusive case). This lets
   * `unit_cost` persist net downstream and the UI show "bruto → neto".
   */
  private normalizeLineItem(
    item: any,
    pricesIncludeTax: boolean,
  ): InvoiceScanResult['line_items'][number] {
    const grossUnit = Number(item.unit_price) || 0;
    // El scanner emite tax_rate como fracción (0.19), no como porcentaje.
    const rawRate = Number(item.tax_rate);
    const taxRate =
      Number.isFinite(rawRate) && rawRate >= 0 ? rawRate : null;
    const r = taxRate ?? 0;
    const unitNet =
      pricesIncludeTax && r > 0 ? grossUnit / (1 + r) : grossUnit;

    const rawPackSize = Number(item.pack_size);

    return {
      description: String(item.description || ''),
      quantity: Number(item.quantity) || 0,
      // unit_price SIEMPRE queda en neto (aplastado si la factura era inclusiva).
      unit_price: unitNet,
      unit_price_gross: grossUnit,
      tax_rate: taxRate,
      total: Number(item.total) || 0,
      sku_if_visible: item.sku_if_visible || undefined,
      // Fase 4: preserva las pistas de UoM emitidas por el perfil ingredient
      // (antes se descartaban en el map original).
      presentation: item.presentation ?? undefined,
      pack_size:
        Number.isFinite(rawPackSize) && rawPackSize > 0
          ? rawPackSize
          : undefined,
      uom_hint: item.uom_hint ?? undefined,
    };
  }

  /**
   * F3 IVA lifecycle — read-only check of the commerce's VAT responsibility.
   * Replicated (not shared) from PurchaseOrdersService.isVatResponsible to
   * avoid modifying that service: same canonical source
   * (SettingsService.getFiscalData().tax_responsibilities, RUT casilla 53),
   * same anti-regression default (no declared responsibilities /
   * indeterminate ⇒ RESPONSIBLE O-48). Never throws.
   */
  private async isVatResponsible(): Promise<boolean> {
    try {
      const fiscalData = await this.settingsService.getFiscalData();
      const responsibilities = Array.isArray(
        (fiscalData as any)?.tax_responsibilities,
      )
        ? ((fiscalData as any).tax_responsibilities as unknown[]).filter(
            (code): code is string => typeof code === 'string',
          )
        : [];
      if (responsibilities.length === 0) return true;
      return responsibilities.includes(
        InvoiceScannerService.VAT_RESPONSIBLE_CODE,
      );
    } catch (error: any) {
      this.logger.warn(
        `isVatResponsible: could not resolve fiscal data (${error?.message}); defaulting to VAT responsible (O-48).`,
      );
      return true;
    }
  }

  /**
   * F3 IVA lifecycle: load the commerce's tax categories with their rates so
   * `matchProducts` can suggest one by rate. tax_categories is store-scoped,
   * but ORGANIZATION-level categories live with store_id = NULL; we mirror the
   * PurchaseOrdersService.create pattern (withoutScope + OR store/null) so the
   * suggestion sees both. Rates are read as fractions (Decimal(6,5)) to match
   * the scanner's fractional tax_rate. Never throws (returns [] on failure).
   */
  private async loadTaxCategoryRates(): Promise<
    Array<{ id: number; rates: number[] }>
  > {
    try {
      const storeId = RequestContextService.getStoreId();
      if (!storeId) return [];
      const categories = await this.prisma
        .withoutScope()
        .tax_categories.findMany({
          where: { OR: [{ store_id: storeId }, { store_id: null }] },
          select: { id: true, tax_rates: { select: { rate: true } } },
        });
      return categories.map((c) => ({
        id: c.id,
        rates: c.tax_rates.map((rate) => Number(rate.rate)),
      }));
    } catch (err: any) {
      this.logger.warn(
        `Could not load tax categories for suggestion: ${err?.message}`,
      );
      return [];
    }
  }

  /**
   * F3 IVA lifecycle: resolve the closest tax_category whose rate matches the
   * line's fractional `tax_rate`. Returns null when there is no rate (exempt /
   * 0 / missing) or no catalog match. Tolerance covers Decimal(6,5) noise
   * (0.19 vs 0.19000). Caller already suppressed the catalog for O-49 tenants.
   */
  private suggestTaxCategoryId(
    taxRate: number | null | undefined,
    taxCategoryRates: Array<{ id: number; rates: number[] }>,
  ): number | null {
    const r = Number(taxRate);
    if (!Number.isFinite(r) || r <= 0 || taxCategoryRates.length === 0) {
      return null;
    }
    const TOLERANCE = 0.005; // fracción
    let best: { id: number; delta: number } | null = null;
    for (const cat of taxCategoryRates) {
      for (const rate of cat.rates) {
        const delta = Math.abs(rate - r);
        if (delta <= TOLERANCE && (best === null || delta < best.delta)) {
          best = { id: cat.id, delta };
        }
      }
    }
    return best?.id ?? null;
  }
}
