import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AIMessage } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { AiScanFile } from '@common/ai-scan-jobs/interfaces/ai-scan-job.interface';
import type { AiJobProgress } from '@common/ai-scan-jobs/ai-job-monitor.service';
import { AiScanHandlerRegistry } from '@common/ai-scan-jobs/ai-scan-handler.registry';
import {
  DetectedIngestFile,
  detectIngestFile,
  IngestSheetFormat,
} from '@common/ai-ingest/ingest-file.detector';
import { SheetParserService } from '@common/ai-ingest/sheets/sheet-parser.service';
import {
  AiExtractionError,
  AiExtractionService,
  newIngestQuotaKey,
} from '@common/ai-ingest/extraction/ai-extraction.service';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import { readDocumentWithAi } from '@common/ai-ingest/documents/document-reader';
import {
  applyColumnMapping,
  ColumnMapping,
  columnMappingSchema,
  mapColumnsBySynonyms,
  mergeAiColumnMapping,
  missingRequiredGroups,
} from '@common/ai-ingest/sheets/column-mapper';
import type {
  IngestRowIssue,
  IngestSkippedRow,
  SheetTable,
} from '@common/ai-ingest/ai-ingest.types';
import {
  InventoryCountItem,
  InventoryCountScanResult,
  MatchedCountProduct,
  InventoryCountScanResponse,
} from './dto/scan-inventory.dto';
import {
  buildInventoryCountInstruction,
  INVENTORY_COUNT_COLUMN_SYNONYMS,
  INVENTORY_COUNT_FIELD_DESCRIPTIONS,
  INVENTORY_COUNT_FIELDS,
  INVENTORY_COUNT_LIMITS,
  INVENTORY_COUNT_MAX_BYTES,
  INVENTORY_COUNT_REQUIRED_FIELDS,
  INVENTORY_COUNT_SCHEMA,
  InventoryCountField,
  inventoryCountProductKey,
  mergeInventoryCountBatches,
  normalizeInventoryCountRow,
} from './inventory-count-ingest.profile';

type CandidateProduct = MatchedCountProduct['candidates'][number];
type ReportProgress = (progress: AiJobProgress) => Promise<void>;

const APP_KEY = 'inventory_count_ocr';
const SAMPLE_ROWS_FOR_MAPPING = 5;

/** What the scan read, before the matching against the catalog. */
interface CountReading {
  scan: InventoryCountScanResult;
  warnings: string[];
  extras: Pick<
    InventoryCountScanResponse,
    'skipped' | 'row_issues' | 'columns' | 'stats'
  >;
}

@Injectable()
export class InventoryCountScannerService implements OnModuleInit {
  private readonly logger = new Logger(InventoryCountScannerService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly aiScanRegistry: AiScanHandlerRegistry,
    private readonly sheetParser: SheetParserService,
    private readonly extraction: AiExtractionService,
    private readonly documentPages: DocumentPagesService,
  ) {}

  /** Registra el handler async `inventory_count` (cola generica `ai-scan`). */
  onModuleInit(): void {
    this.aiScanRegistry.register<InventoryCountScanResponse>(
      'inventory_count',
      ({ files, params, reportProgress }) =>
        this.scanCountFromFiles(
          files,
          Number(params?.location_id),
          reportProgress,
        ),
    );
  }

  async scanCount(
    file: Express.Multer.File,
    locationId: number,
  ): Promise<InventoryCountScanResponse> {
    return this.scanCountFromFiles([this.toScanFile(file)], locationId);
  }

  /**
   * Nucleo (buffer + tipo REAL por firma, sin multer): sincrono y handler
   * async. ia-cargas F5a (#8):
   *  - Hoja (xlsx/xls/csv): parser determinista, columnas por sinónimos (a lo
   *    sumo UNA llamada de mapeo) y código para todas las filas; lo omitido
   *    va a `skipped` con su fila y motivo.
   *  - PDF/foto: lector común por páginas (texto nativo primero), 2 páginas
   *    por llamada; un lote cortado se parte; fotos largas en franjas.
   * El matching contra el catálogo y la aplicación de ajustes no cambian.
   */
  async scanCountFromFiles(
    files: AiScanFile[],
    locationId: number,
    reportProgress?: ReportProgress,
  ): Promise<InventoryCountScanResponse> {
    const file = files?.[0];
    const detected = this.assertValidScanFile(file);
    // One quota key per load: mapping, page batches and repairs charge one job.
    const quotaKey = newIngestQuotaKey();
    const reading =
      detected.kind === 'sheet'
        ? await this.readSheet(file, detected.sheetFormat!, quotaKey, reportProgress)
        : await this.readDocument(file, detected, quotaKey, reportProgress);
    const { matched_products, warnings } = await this.matchProducts(
      reading.scan,
      locationId,
      reportProgress,
    );
    return {
      scan: reading.scan,
      matched_products,
      warnings: [...reading.warnings, ...warnings],
      ...reading.extras,
    };
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
   * Validacion previa reutilizable por el controller async (antes de encolar):
   * archivo presente, tamaño y tipo REAL por firma (no el mimetype del
   * cliente). Acepta PDF, fotos (JPG/PNG/WebP) y hojas (xlsx/xls/csv).
   */
  assertValidScanFile(file?: AiScanFile | null): DetectedIngestFile {
    if (!file?.buffer?.length) throw new VendixHttpException(ErrorCodes.INV_SCAN_NO_FILE);
    if (file.buffer.length > INVENTORY_COUNT_MAX_BYTES) {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_INVALID_FILE,
        'El archivo debe pesar como máximo 10 MB.',
      );
    }
    const detected = detectIngestFile({
      buffer: file.buffer,
      originalName: file.originalName,
      mimeType: file.mimeType,
    });
    if (!detected) {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_INVALID_FILE,
        'Formato no soportado. Sube una foto (JPG, PNG o WebP), un PDF o una hoja de cálculo (Excel o CSV).',
      );
    }
    return detected;
  }

  // --- Private helpers ---

  /**
   * PDF o foto por el lector común: texto nativo primero, escaneadas y fotos
   * como imagen (fotos muy largas en franjas cuyo solape se fusiona), 2
   * páginas por llamada con esquema y reparación. Las páginas que no se
   * leen quedan en `warnings` con su número.
   */
  private async readDocument(
    file: AiScanFile,
    detected: DetectedIngestFile,
    quotaKey: string,
    reportProgress?: ReportProgress,
  ): Promise<CountReading> {
    let read;
    try {
      read = await readDocumentWithAi<Record<string, any>>({
        file: { buffer: file.buffer, originalName: file.originalName },
        mimeType: detected.mime,
        pages: this.documentPages,
        extraction: this.extraction,
        appKey: APP_KEY,
        schema: INVENTORY_COUNT_SCHEMA,
        instruction: buildInventoryCountInstruction,
        limits: INVENTORY_COUNT_LIMITS,
        maxBytes: INVENTORY_COUNT_MAX_BYTES,
        quotaKey,
        reportProgress,
        logLabel: 'InventoryCountScan',
      });
    } catch (err) {
      throw this.toScanError(err);
    }
    const strips = read.batches.length > 1 && detected.kind === 'image';
    const merged = mergeInventoryCountBatches(read.batches, { strips });
    const scan = this.normalizeCountOcrResponse(merged.data);
    return {
      scan,
      warnings: [...read.warnings, ...merged.warnings],
      extras: {
        stats: {
          source: 'document',
          total_rows: scan.counted_items.length,
          imported_rows: scan.counted_items.length,
          skipped_rows: 0,
          mapping: null,
          pages: read.pages,
          text_pages: read.textPages,
        },
      },
    };
  }

  /**
   * Hoja de cálculo: parser determinista → columnas por sinónimos (UNA llamada
   * de mapeo solo si no cubren producto + cantidad) → código para todas las
   * filas. Ninguna fila se pierde en silencio: lo que no es un conteo va a
   * `skipped` con su fila y motivo, y un producto repetido queda avisado.
   */
  private async readSheet(
    file: AiScanFile,
    format: IngestSheetFormat,
    quotaKey: string,
    reportProgress?: ReportProgress,
  ): Promise<CountReading> {
    const progress = async (done: number, total: number) => {
      if (!reportProgress || total <= 0) return;
      try {
        await reportProgress({ done, total, stage: 'Leyendo la hoja', unit: 'filas' });
      } catch {
        // Progress is best effort.
      }
    };

    const parsed = this.sheetParser.parse(file.buffer, format, {
      maxRows: INVENTORY_COUNT_LIMITS.maxRows,
    });
    if (!parsed.tables.length) {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_INVALID_FILE,
        'La hoja no tiene filas con datos.',
      );
    }
    const warnings = [...parsed.warnings];
    const skipped: IngestSkippedRow[] = [...parsed.skipped];
    const rowIssues: IngestRowIssue[] = [];
    const columns: NonNullable<InventoryCountScanResponse['columns']> = [];
    const items: InventoryCountItem[] = [];
    const totalRows = parsed.tables.reduce((n, t) => n + t.rows.length, 0);
    const multi = parsed.tables.length > 1;
    let mappingMode: 'synonyms' | 'ai' = 'synonyms';
    let done = 0;
    await progress(0, totalRows);

    for (const table of parsed.tables) {
      const sheet = multi ? table.sheet : undefined;
      const { mapping, usedAi } = await this.mapColumns(table, warnings, quotaKey);
      if (usedAi) mappingMode = 'ai';
      for (const header of table.headers) {
        columns.push({ ...(sheet ? { sheet } : {}), column: header, field: mapping.get(header) ?? null });
      }
      const missing = missingRequiredGroups(mapping, INVENTORY_COUNT_REQUIRED_FIELDS);
      if (missing.length) {
        warnings.push(
          `No se reconoció ${missing.some((g) => g.includes('quantity')) ? 'la columna de cantidad contada' : 'la columna de producto (nombre, SKU o código de barras)'}${sheet ? ` en la hoja "${sheet}"` : ''}; revisa los encabezados.`,
        );
        if (table.row_numbers.length) {
          skipped.push({
            row: table.row_numbers[0],
            row_end: table.row_numbers[table.row_numbers.length - 1],
            ...(sheet ? { sheet } : {}),
            reason: 'unreadable',
            message: 'La hoja no tiene columnas de producto y cantidad reconocibles.',
          });
        }
        done += table.rows.length;
        continue;
      }
      const ignored = table.headers.filter((h) => !mapping.has(h));
      if (ignored.length) {
        warnings.push(`Columnas ignoradas${sheet ? ` en "${sheet}"` : ''}: ${ignored.join(', ')}.`);
      }

      const firstRowOf = new Map<string, number>();
      table.rows.forEach((row, i) => {
        const ctx = { row: table.row_numbers[i], ...(sheet ? { sheet } : {}) };
        const { record, issues, skipMessage } = normalizeInventoryCountRow(
          applyColumnMapping(row, mapping),
          ctx,
        );
        rowIssues.push(...issues);
        if (!record) {
          skipped.push({ ...ctx, reason: 'unreadable', message: skipMessage ?? 'Fila sin datos de conteo.' });
          return;
        }
        // The same product on two rows (two shelves) is kept as counted:
        // nothing is summed or dropped, the operator is told.
        const key = inventoryCountProductKey(record);
        const first = firstRowOf.get(key);
        if (first != null) {
          rowIssues.push({
            ...ctx,
            level: 'warning',
            message: `El producto "${record.description}" ya aparece en la fila ${first}; se cargaron las dos filas.`,
          });
        } else {
          firstRowOf.set(key, ctx.row);
        }
        items.push(record);
      });
      done += table.rows.length;
      await progress(done, totalRows);
    }

    const byPosition = (a: { row: number; sheet?: string }, b: { row: number; sheet?: string }) =>
      (a.sheet ?? '').localeCompare(b.sheet ?? '') || a.row - b.row;
    skipped.sort(byPosition);
    rowIssues.sort(byPosition);
    const omitted = skipped.reduce((n, s) => n + (s.row_end ? s.row_end - s.row + 1 : 1), 0);
    if (omitted) {
      warnings.push(`${omitted} fila(s) de la hoja no se cargaron; mira "Filas omitidas" para ver cuáles y por qué.`);
    }

    return {
      // Read by code, not guessed: the low-confidence banner does not apply.
      scan: { counted_items: items, sheet_notes: null, confidence: 100, extraction_notes: null },
      warnings,
      extras: {
        skipped,
        row_issues: rowIssues,
        columns,
        stats: {
          source: 'sheet',
          total_rows: parsed.total_rows,
          imported_rows: items.length,
          skipped_rows: omitted,
          mapping: mappingMode,
        },
      },
    };
  }

  /**
   * Encabezados → campos. Primero sinónimos; si no cubren producto + cantidad,
   * UNA llamada con encabezados + 5 filas de muestra devuelve el mapeo, que se
   * aplica con código a todas las filas. Si la IA no responde algo usable, se
   * sigue con los sinónimos y se avisa.
   */
  private async mapColumns(
    table: SheetTable,
    warnings: string[],
    quotaKey: string,
  ): Promise<{ mapping: ColumnMapping<InventoryCountField>; usedAi: boolean }> {
    const synonyms = mapColumnsBySynonyms<InventoryCountField>(
      table.headers,
      INVENTORY_COUNT_COLUMN_SYNONYMS,
    );
    if (!missingRequiredGroups(synonyms, INVENTORY_COUNT_REQUIRED_FIELDS).length) {
      return { mapping: synonyms, usedAi: false };
    }
    const sample = table.rows.slice(0, SAMPLE_ROWS_FOR_MAPPING);
    const fieldList = INVENTORY_COUNT_FIELDS.map(
      (f) => `- ${f}: ${INVENTORY_COUNT_FIELD_DESCRIPTIONS[f]}`,
    ).join('\n');
    const message: AIMessage = {
      role: 'user',
      content: [
        'TASK FOR THIS REQUEST (it replaces the output format of your instructions): do NOT extract the count.',
        'Map each column of an inventory count spreadsheet to ONE field, or "ignore".',
        'Return ONLY a JSON object: {"columns":[{"column":"<exact column name>","field":"<field or ignore>"}],"warnings":[]}.',
        'Use each field at most once. Use the sample values, not only the column names. The counted quantity is the PHYSICAL count, not the system stock or a price.',
        'Fields:',
        fieldList,
        `Columns: ${JSON.stringify(table.headers)}`,
        `Sample rows: ${JSON.stringify(sample)}`,
      ].join('\n'),
    };
    try {
      const answer = await this.extraction.extract<{
        columns?: { column?: unknown; field?: unknown }[];
      }>({
        appKey: APP_KEY,
        schema: columnMappingSchema(INVENTORY_COUNT_FIELDS),
        messages: [message],
        quotaKey,
      });
      return {
        mapping: mergeAiColumnMapping(synonyms, table.headers, INVENTORY_COUNT_FIELDS, answer),
        usedAi: true,
      };
    } catch (error) {
      // The AI is down: the job fails (and is retried). An unusable answer
      // falls back to the synonyms, and the sheet says what it could not map.
      if (!(error instanceof AiExtractionError) || error.failure === 'ai_failed') {
        throw this.toScanError(error);
      }
      this.logger.warn(
        `[InventoryCountScan] column mapping by AI failed (${error.failure}); using synonyms only`,
      );
      return { mapping: synonyms, usedAi: false };
    }
  }

  /**
   * Keeps the scanner's error contract: an unusable model answer is still
   * `INV_SCAN_PARSE_FAIL` and an AI failure `INV_SCAN_AI_FAIL`. Document
   * problems keep their `AI_INGEST_*` code and credits / rate limit their
   * `AI_PROVIDER_*` one.
   */
  private toScanError(err: unknown): unknown {
    const error = err instanceof AiExtractionError ? err.toHttpException() : err;
    if (!(error instanceof VendixHttpException)) return error;
    if (error.errorCode === ErrorCodes.AI_INGEST_PARSE_FAIL.code) {
      return new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL);
    }
    if (error.errorCode === ErrorCodes.AI_REQUEST_001.code) {
      return new VendixHttpException(ErrorCodes.INV_SCAN_AI_FAIL);
    }
    return error;
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
    reportProgress?: (progress: AiJobProgress) => Promise<void>,
  ): Promise<{ matched_products: MatchedCountProduct[]; warnings: string[] }> {
    const warnings: string[] = [];
    const matched_products: MatchedCountProduct[] = [];

    const total = scan.counted_items.length;
    for (let idx = 0; idx < total; idx++) {
      // Real progress for the web bar, throttled to every 5th line.
      if (idx % 5 === 0) {
        await reportProgress?.({
          done: idx,
          total,
          stage: 'Cruzando los productos contados con tu inventario',
        });
      }
      const item = scan.counted_items[idx];
      // Sheets say the row the operator sees in Excel; documents the line.
      const where = item.source_row
        ? `Fila ${item.source_row}${item.source_sheet ? ` (${item.source_sheet})` : ''}`
        : `Línea ${idx + 1}`;
      const origin = item.source_row
        ? { source_row: item.source_row, ...(item.source_sheet ? { source_sheet: item.source_sheet } : {}) }
        : {};

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
            `${where}: '${item.description}' coincide con un producto de múltiples variantes en esta ubicación, selecciona la variante manualmente`,
          );
        } else if (matchStatus === 'new' || selectedProductId == null) {
          warnings.push(
            `${where}: '${item.description}' no coincide con catálogo, revisar`,
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
          ...origin,
        });
      } catch (err: any) {
        this.logger.warn(
          `Item matching failed for "${item.description}": ${err?.message}`,
        );
        warnings.push(
          `${where}: '${item.description}' no coincide con catálogo, revisar`,
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
          ...origin,
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
