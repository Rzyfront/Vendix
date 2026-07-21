import { Injectable, Logger } from '@nestjs/common';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../ai-engine/interfaces/ai-provider.interface';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  ExpenseLineItem,
  ExpenseScanResult,
  ExpenseScanResponse,
  MatchedCategory,
} from './dto/scan-expense.dto';
import sharp = require('sharp');

@Injectable()
export class ExpenseScannerService {
  private readonly logger = new Logger(ExpenseScannerService.name);

  /**
   * Stopwords en español que se filtran del matching Tier 3 (word overlap) para
   * no inflar el score con palabras vacías.
   */
  private static readonly STOPWORDS_ES = new Set([
    'de',
    'la',
    'el',
    'y',
    'en',
    'los',
    'las',
    'del',
    'un',
    'una',
  ]);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
  ) {}

  /**
   * ENQUEUE path (HTTP). Corre el preprocesamiento sharp sobre el buffer multer
   * (que solo existe en el request) y devuelve el data URI listo para encolar.
   * NO hace OCR síncrono: la parte pesada la ejecuta el worker vía
   * `scanFromImage`.
   */
  async prepareImage(
    file: Express.Multer.File,
  ): Promise<{ dataUri: string; mimeType: string }> {
    this.logger.debug(
      `[ExpenseScan] Preparing image: mimetype=${file.mimetype}, size=${file.size}, buffer=${file.buffer?.length ?? 'NO BUFFER'}`,
    );

    const { base64, mimeType } = await this.preprocessImage(file);
    const dataUri = `data:${mimeType};base64,${base64}`;

    this.logger.debug(
      `[ExpenseScan] DataURI length: ${dataUri.length} chars`,
    );

    return { dataUri, mimeType };
  }

  /**
   * WORKER path (BullMQ). Parte pesada del escaneo: OCR (run) + parse + matching
   * de categoría. Debe correr dentro de `RequestContextService.run(...)` (lo hace
   * el processor) para que el matching organization-scoped funcione.
   *
   * El retorno es exactamente `ExpenseScanResponse` (misma forma que el camino
   * síncrono anterior) y queda persistido en `job.returnvalue`.
   */
  async scanFromImage(
    dataUri: string,
    mimeType: string,
  ): Promise<ExpenseScanResponse> {
    const scan = await this.runOcr(dataUri, mimeType);
    const matched_category = await this.matchCategory(
      scan.supplier_name,
      scan.line_items,
    );
    return { scan, matched_category };
  }

  // --- Private helpers ---

  private async runOcr(
    dataUri: string,
    mimeType: string,
  ): Promise<ExpenseScanResult> {
    this.logger.debug(
      `[ExpenseScan] Worker OCR: mimeType=${mimeType}, dataUri length=${dataUri.length} chars`,
    );

    const imageMessage: AIMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract the expense invoice data. Return ONLY valid JSON matching the schema defined in your system instructions.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    this.logger.debug(`[ExpenseScan] Sending to AI engine...`);
    const response = await this.aiEngine.run('expense_invoice_ocr', {}, [
      imageMessage,
    ]);

    this.logger.debug(
      `[ExpenseScan] AI response: success=${response.success}, contentLength=${response.content?.length ?? 0}, model=${response.model}, error=${response.error}`,
    );
    this.logger.debug(
      `[ExpenseScan] AI content preview: ${response.content?.substring(0, 300)}`,
    );

    if (!response.success || !response.content) {
      this.logger.error(`AI expense OCR failed: ${response.error}`);
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
      return this.normalizeExpenseOcrResponse(parsed);
    } catch (err) {
      if (err instanceof VendixHttpException) throw err;
      this.logger.error(
        `Failed to parse AI expense OCR response: ${response.content}`,
      );
      throw new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL);
    }
  }

  /**
   * Matching fuzzy de categoría: combina el nombre del proveedor + las
   * descripciones de los items como texto candidato y lo compara contra
   * las `expense_categories` activas del org.
   *
   * Tiers:
   *  - Tier 1: match exacto case-insensitive = 100
   *  - Tier 2: normalized contains (sin acentos, trim, lower) = 65 + ratio*20 (cap 85)
   *  - Tier 3: word overlap (filtrando stopwords ES) = (matches/maxWords)*60
   *
   * Umbral ≥65 → retorna {id, name, confidence}; si no → null.
   */
  private async matchCategory(
    supplierName: string | null,
    lineItems: ExpenseLineItem[],
  ): Promise<MatchedCategory | null> {
    const candidateText = `${supplierName ?? ''} ${lineItems
      .map((i) => i.description)
      .join(' ')}`.trim();

    if (!candidateText) return null;

    try {
      const categories = await this.prisma.expense_categories.findMany({
        where: {
          ...this.prisma.organizationWhere,
          is_active: true,
        },
        select: { id: true, name: true },
      });

      if (categories.length === 0) return null;

      const candidateLower = this.normalizeText(candidateText);
      let bestMatch: { id: number; name: string } | null = null;
      let bestScore = 0;

      for (const cat of categories) {
        const catLower = this.normalizeText(cat.name);
        if (!catLower) continue;

        // Tier 1: exact match
        if (catLower === candidateLower) {
          return { id: cat.id, name: cat.name, confidence: 100 };
        }

        // Tier 2: bidirectional normalized contains
        if (
          catLower.includes(candidateLower) ||
          candidateLower.includes(catLower)
        ) {
          const ratio =
            Math.min(candidateLower.length, catLower.length) /
            Math.max(candidateLower.length, catLower.length);
          const score = Math.min(85, 65 + ratio * 20);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = cat;
          }
          continue;
        }

        // Tier 3: word overlap (filtrando stopwords ES)
        const candidateWords = candidateLower
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 1 &&
              !ExpenseScannerService.STOPWORDS_ES.has(w),
          );
        const catWords = catLower
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 1 &&
              !ExpenseScannerService.STOPWORDS_ES.has(w),
          );

        if (candidateWords.length === 0 || catWords.length === 0) continue;

        let matches = 0;
        for (const cw of candidateWords) {
          for (const dw of catWords) {
            if (dw.includes(cw) || cw.includes(dw)) {
              matches++;
              break;
            }
          }
        }

        const score =
          (matches / Math.max(candidateWords.length, catWords.length)) *
          60;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = cat;
        }
      }

      if (bestMatch && bestScore >= 65) {
        return {
          id: bestMatch.id,
          name: bestMatch.name,
          confidence: Math.round(bestScore),
        };
      }

      return null;
    } catch (err: any) {
      this.logger.warn(
        `Expense category matching failed gracefully: ${err?.message}`,
      );
      return null;
    }
  }

  /**
   * Normaliza texto: quita acentos/tildes, trim, lower.
   */
  private normalizeText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Replicado verbatim de `invoice-scanner.service.ts` / `rut-scanner.service.ts`:
   * sharp resize ≤1536, JPEG q85; si falla (PDFs, formatos no soportados) pasa
   * el buffer crudo con su mimetype original para que el modelo de visión lo
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
        `[ExpenseScan] Image preprocessed: ${file.size} bytes → ${processedBuffer.length} bytes (${metadata.width}x${metadata.height}${needsResize ? ' resized' : ''})`,
      );

      return {
        base64: processedBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      };
    } catch (err) {
      this.logger.warn(
        `[ExpenseScan] Image preprocessing failed, using raw: ${err.message}`,
      );
      return {
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
      };
    }
  }

  private normalizeExpenseOcrResponse(parsed: any): ExpenseScanResult {
    const lineItems: ExpenseLineItem[] = Array.isArray(parsed.line_items)
      ? parsed.line_items.map((item: any, idx: number) => ({
          description: String(item.description ?? ''),
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          amount: Number(item.amount) || 0,
          line_index:
            Number.isFinite(Number(item.line_index))
              ? Number(item.line_index)
              : idx,
        }))
      : [];

    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(100, confidence));

    return {
      supplier_name:
        parsed.supplier_name != null ? String(parsed.supplier_name) : null,
      supplier_tax_id:
        parsed.supplier_tax_id != null
          ? String(parsed.supplier_tax_id)
          : null,
      invoice_number:
        parsed.invoice_number != null
          ? String(parsed.invoice_number)
          : null,
      invoice_date:
        parsed.invoice_date != null ? String(parsed.invoice_date) : null,
      currency: String(parsed.currency ?? 'COP') || 'COP',
      line_items: lineItems,
      subtotal: Number(parsed.subtotal) || 0,
      tax_amount:
        parsed.tax_amount != null ? Number(parsed.tax_amount) || 0 : null,
      total: Number(parsed.total) || 0,
      confidence,
      extraction_notes:
        parsed.extraction_notes != null &&
        String(parsed.extraction_notes).trim()
          ? String(parsed.extraction_notes).trim()
          : null,
    };
  }
}