import { Injectable, Logger } from '@nestjs/common';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  InventoryCountItem,
  InventoryCountScanResult,
  MatchedCountProduct,
  InventoryCountScanResponse,
} from './dto/scan-inventory.dto';
import sharp = require('sharp');

type CandidateProduct = MatchedCountProduct['candidates'][number];

@Injectable()
export class InventoryCountScannerService {
  private readonly logger = new Logger(InventoryCountScannerService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
  ) {}

  async scanCount(
    file: Express.Multer.File,
    locationId: number,
  ): Promise<InventoryCountScanResponse> {
    const scan = await this.runOcr(file);
    const { matched_products, warnings } = await this.matchProducts(
      scan,
      locationId,
    );
    return { scan, matched_products, warnings };
  }

  // --- Private helpers ---

  private async runOcr(
    file: Express.Multer.File,
  ): Promise<InventoryCountScanResult> {
    this.logger.debug(
      `[InventoryCountScan] File: mimetype=${file.mimetype}, size=${file.size}, buffer=${file.buffer?.length ?? 'NO BUFFER'}`,
    );

    const { base64, mimeType } = await this.preprocessImage(file);
    const dataUri = `data:${mimeType};base64,${base64}`;

    this.logger.debug(
      `[InventoryCountScan] DataURI length: ${dataUri.length} chars`,
    );

    const imageMessage: AIMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract the inventory count sheet data. Return ONLY valid JSON matching the schema defined in your system instructions.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    this.logger.debug(`[InventoryCountScan] Sending to AI engine...`);
    const response = await this.aiEngine.run('inventory_count_ocr', {}, [
      imageMessage,
    ]);

    this.logger.debug(
      `[InventoryCountScan] AI response: success=${response.success}, contentLength=${response.content?.length ?? 0}, model=${response.model}, error=${response.error}`,
    );
    this.logger.debug(
      `[InventoryCountScan] AI content preview: ${response.content?.substring(0, 300)}`,
    );

    if (!response.success || !response.content) {
      this.logger.error(`AI inventory count OCR failed: ${response.error}`);
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
      return this.normalizeCountOcrResponse(parsed);
    } catch (err) {
      if (err instanceof VendixHttpException) throw err;
      this.logger.error(
        `Failed to parse AI inventory count OCR response: ${response.content}`,
      );
      throw new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL);
    }
  }

  /**
   * Resuelve candidatos de producto para cada `counted_item` y clasifica su
   * `match_status`:
   *  - `matched`: mejor candidato con confidence >=90 → autoselecciona.
   *  - `partial`: mejor candidato en [50,89] → autoselecciona solo si >=80,
   *    si no queda como candidates para selección manual.
   *  - `new`: sin candidatos o mejor candidato <50.
   *
   * Resolución de variante (vendix-product-variants): un candidato
   * autoseleccionado solo se mantiene autoseleccionado si su variante en
   * `stock_levels` para esta `locationId` es resoluble sin ambigüedad (0 o 1
   * fila). Si hay múltiples variantes con stock en esta location, NUNCA se
   * adivina — se degrada a `selected_product_id: null` (queda en
   * `candidates` para que el usuario elija manualmente) y se agrega un
   * warning específico.
   *
   * Nunca lanza por item individual: un fallo de matching de una línea no
   * debe tumbar el escaneo completo (mismo patrón defensivo que
   * InvoiceScannerService.matchProducts).
   */
  private async matchProducts(
    scan: InventoryCountScanResult,
    locationId: number,
  ): Promise<{ matched_products: MatchedCountProduct[]; warnings: string[] }> {
    const warnings: string[] = [];
    const matched_products: MatchedCountProduct[] = [];

    for (let idx = 0; idx < scan.counted_items.length; idx++) {
      const item = scan.counted_items[idx];

      try {
        const { candidates, stockInfoByProductId } =
          await this.findProductCandidates(item, locationId);
        const topCandidate = candidates.length > 0 ? candidates[0] : null;

        let matchStatus: 'matched' | 'partial' | 'new' = 'new';
        let selectedProductId: number | null = null;
        let selectedProductName: string | null = null;

        if (topCandidate) {
          if (topCandidate.confidence >= 90) {
            matchStatus = 'matched';
            selectedProductId = topCandidate.id;
            selectedProductName = topCandidate.name;
          } else if (topCandidate.confidence >= 50) {
            matchStatus = 'partial';
            if (topCandidate.confidence >= 80) {
              selectedProductId = topCandidate.id;
              selectedProductName = topCandidate.name;
            }
          }
        }

        let selectedVariantId: number | null = null;
        let stockOnHand: number | null = null;
        let ambiguousVariant = false;

        if (selectedProductId != null) {
          const info = stockInfoByProductId.get(selectedProductId);
          if (info !== undefined && info.variantId === undefined) {
            // Múltiples variantes con stock en esta location: no se puede
            // resolver sin adivinar. Se revierte el auto-match.
            ambiguousVariant = true;
            selectedProductId = null;
            selectedProductName = null;
          } else if (info !== undefined) {
            selectedVariantId = info.variantId ?? null;
            stockOnHand = info.stockOnHand;
          }
        }

        if (ambiguousVariant) {
          warnings.push(
            `Línea ${idx + 1}: '${item.description}' coincide con un producto de múltiples variantes en esta ubicación, selecciona la variante manualmente`,
          );
        } else if (matchStatus === 'new' || selectedProductId == null) {
          warnings.push(
            `Línea ${idx + 1}: '${item.description}' no coincide con catálogo, revisar`,
          );
        }

        matched_products.push({
          description: item.description,
          counted_quantity: item.quantity,
          sku_if_visible: item.sku_if_visible ?? null,
          barcode_if_visible: item.barcode_if_visible ?? null,
          match_status: matchStatus,
          selected_product_id: selectedProductId,
          selected_product_name: selectedProductName,
          selected_product_variant_id: selectedVariantId,
          stock_on_hand: stockOnHand,
          candidates,
        });
      } catch (err: any) {
        this.logger.warn(
          `Item matching failed for "${item.description}": ${err?.message}`,
        );
        warnings.push(
          `Línea ${idx + 1}: '${item.description}' no coincide con catálogo, revisar`,
        );
        matched_products.push({
          description: item.description,
          counted_quantity: item.quantity,
          sku_if_visible: item.sku_if_visible ?? null,
          barcode_if_visible: item.barcode_if_visible ?? null,
          match_status: 'new',
          selected_product_id: null,
          selected_product_name: null,
          selected_product_variant_id: null,
          stock_on_hand: null,
          candidates: [],
        });
      }
    }

    return { matched_products, warnings };
  }

  /**
   * Dos tiers propios (adaptación de InvoiceScannerService.findProductCandidates
   * L393-492, sin la Tier 2 de supplier_products que no aplica a un reconteo):
   *
   *  - Tier "SKU/barcode exacto": si viene `sku_if_visible`, match exacto
   *    case-insensitive por `sku`; si no vino sku pero sí `barcode_if_visible`,
   *    match exacto por `barcode`. A diferencia del original (que no filtra
   *    `state`), acá se excluyen productos `archived` — no tiene sentido
   *    matchear un reconteo físico contra un producto descontinuado.
   *    confidence 95 en ambos casos.
   *  - Tier "name keywords": adaptación de Tier 3 real (L454-486) + fuzzyScore
   *    (L494-517, copiado tal cual).
   *
   * Además resuelve, para cada candidato, su variante y stock en
   * `stock_levels` para `locationId` en UNA sola consulta batched (evita
   * N+1 por candidato; fusiona lo que antes hacía `resolveStockOnHand` por
   * separado). Regla de variante (skill vendix-product-variants — "nunca
   * adivinar ante ambigüedad real"):
   *  - 0 filas en `stock_levels` para (product_id, locationId): no hay
   *    evidencia de variantes con stock aquí → `variantId: null` (caso
   *    normal de producto simple), stock cae al agregado denormalizado
   *    `products.stock_quantity`.
   *  - 1 fila: esa es la variante real — puede ser `null` genuino (producto
   *    simple) o un id real de variante.
   *  - >1 filas: múltiples variantes con stock en esta location →
   *    `variantId: undefined` ("no resuelto", ambigüedad real). El stock
   *    mostrado es la suma de todas las filas de esa location.
   */
  private async findProductCandidates(
    item: InventoryCountItem,
    locationId: number,
  ): Promise<{
    candidates: CandidateProduct[];
    stockInfoByProductId: Map<
      number,
      { variantId: number | null | undefined; stockOnHand: number }
    >;
  }> {
    const rawCandidates: {
      id: number;
      name: string;
      sku: string | null;
      confidence: number;
    }[] = [];
    const seenIds = new Set<number>();

    // Tier: SKU/barcode exacto
    if (item.sku_if_visible) {
      const bySku = await this.prisma.products.findFirst({
        where: {
          sku: { equals: item.sku_if_visible, mode: 'insensitive' },
          state: { not: 'archived' },
        },
        select: { id: true, name: true, sku: true },
      });
      if (bySku) {
        seenIds.add(bySku.id);
        rawCandidates.push({
          id: bySku.id,
          name: bySku.name,
          sku: bySku.sku,
          confidence: 95,
        });
      }
    } else if (item.barcode_if_visible) {
      const byBarcode = await this.prisma.products.findFirst({
        where: {
          barcode: { equals: item.barcode_if_visible },
          state: { not: 'archived' },
        },
        select: { id: true, name: true, sku: true },
      });
      if (byBarcode) {
        seenIds.add(byBarcode.id);
        rawCandidates.push({
          id: byBarcode.id,
          name: byBarcode.name,
          sku: byBarcode.sku,
          confidence: 95,
        });
      }
    }

    // Tier: name keywords
    const keywords = item.description
      .split(/[\s,;.\-\/()]+/)
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
        select: { id: true, name: true, sku: true },
        take: 10,
      });

      for (const p of nameMatches) {
        if (seenIds.has(p.id)) continue;
        const score = this.fuzzyScore(item.description, p.name);
        if (score >= 25) {
          seenIds.add(p.id);
          rawCandidates.push({
            id: p.id,
            name: p.name,
            sku: p.sku,
            confidence: Math.min(score, 100),
          });
        }
      }
    }

    rawCandidates.sort((a, b) => b.confidence - a.confidence);
    const topRaw = rawCandidates.slice(0, 5);

    const stockInfoByProductId = new Map<
      number,
      { variantId: number | null | undefined; stockOnHand: number }
    >();

    if (topRaw.length > 0) {
      const ids = topRaw.map((c) => c.id);
      try {
        const stockRows = await this.prisma.stock_levels.findMany({
          where: { product_id: { in: ids }, location_id: locationId },
          select: {
            product_id: true,
            product_variant_id: true,
            quantity_on_hand: true,
          },
        });

        const rowsByProduct = new Map<number, typeof stockRows>();
        for (const row of stockRows) {
          const list = rowsByProduct.get(row.product_id) ?? [];
          list.push(row);
          rowsByProduct.set(row.product_id, list);
        }

        const missingIds: number[] = [];
        for (const id of ids) {
          const rows = rowsByProduct.get(id) ?? [];
          if (rows.length === 0) {
            missingIds.push(id);
          } else if (rows.length === 1) {
            stockInfoByProductId.set(id, {
              variantId: rows[0].product_variant_id,
              stockOnHand: rows[0].quantity_on_hand,
            });
          } else {
            stockInfoByProductId.set(id, {
              variantId: undefined,
              stockOnHand: rows.reduce((sum, r) => sum + r.quantity_on_hand, 0),
            });
          }
        }

        if (missingIds.length > 0) {
          const productsFallback = await this.prisma.products.findMany({
            where: { id: { in: missingIds } },
            select: { id: true, stock_quantity: true },
          });
          for (const p of productsFallback) {
            stockInfoByProductId.set(p.id, {
              variantId: null,
              stockOnHand: p.stock_quantity ?? 0,
            });
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `Stock/variant resolution failed for candidates [${ids.join(',')}]: ${err?.message}`,
        );
        // Fail-open: no bloquear el match por un fallo de esta consulta de
        // solo-lectura — se asume stock 0 sin variante (mismo espíritu
        // defensivo que el resolveStockOnHand original).
        for (const id of ids) {
          if (!stockInfoByProductId.has(id)) {
            stockInfoByProductId.set(id, { variantId: null, stockOnHand: 0 });
          }
        }
      }
    }

    const candidates: CandidateProduct[] = topRaw.map((c) => {
      const info = stockInfoByProductId.get(c.id);
      return {
        ...c,
        product_variant_id: info ? info.variantId : undefined,
      };
    });

    return { candidates, stockInfoByProductId };
  }

  /**
   * Copiado tal cual de InvoiceScannerService.fuzzyScore (L494-517).
   */
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

  /**
   * Copiado verbatim de ExpenseScannerService.preprocessImage (L248-290) /
   * InvoiceScannerService.preprocessImage (L519-561): sharp resize ≤1536,
   * JPEG q85; si falla (PDFs, formatos no soportados por sharp) pasa el
   * buffer crudo con su mimetype original para que el modelo de visión lo
   * procese nativamente.
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

      this.logger.debug(
        `[InventoryCountScan] Image preprocessed: ${file.size} bytes → ${processedBuffer.length} bytes (${metadata.width}x${metadata.height}${needsResize ? ' resized' : ''})`,
      );

      return {
        base64: processedBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      };
    } catch (err) {
      this.logger.warn(
        `[InventoryCountScan] Image preprocessing failed, using raw: ${err.message}`,
      );
      return {
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
      };
    }
  }

  /**
   * Normalización defensiva del JSON del modelo — mismo estilo que
   * ExpenseScannerService.normalizeExpenseOcrResponse (L292-336).
   */
  private normalizeCountOcrResponse(parsed: any): InventoryCountScanResult {
    const countedItems: InventoryCountItem[] = Array.isArray(
      parsed?.counted_items,
    )
      ? parsed.counted_items.map((item: any) => {
          let itemConfidence = Number(item?.confidence);
          if (!Number.isFinite(itemConfidence)) itemConfidence = 0;
          itemConfidence = Math.max(0, Math.min(100, itemConfidence));

          return {
            description: String(item?.description ?? ''),
            quantity: Number(item?.quantity) || 0,
            sku_if_visible:
              item?.sku_if_visible != null
                ? String(item.sku_if_visible)
                : null,
            barcode_if_visible:
              item?.barcode_if_visible != null
                ? String(item.barcode_if_visible)
                : null,
            confidence: itemConfidence,
          };
        })
      : [];

    let confidence = Number(parsed?.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(100, confidence));

    return {
      counted_items: countedItems,
      sheet_notes:
        parsed?.sheet_notes != null && String(parsed.sheet_notes).trim()
          ? String(parsed.sheet_notes).trim()
          : null,
      confidence,
      extraction_notes:
        parsed?.extraction_notes != null &&
        String(parsed.extraction_notes).trim()
          ? String(parsed.extraction_notes).trim()
          : null,
    };
  }
}
