import { Injectable, Logger } from '@nestjs/common';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../ai-engine/interfaces/ai-provider.interface';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import sharp = require('sharp');

/**
 * Normalized RUT extraction contract.
 *
 * Every field is already mapped to the legal/tax form enums/codes so the
 * frontend can patch the `fiscal_data` form 1:1 without any further mapping.
 */
export interface RutScanResult {
  /** Solo número, SIN dígito de verificación. */
  nit: string;
  /** Un solo dígito de verificación. */
  nit_dv: string;
  /** RUT siempre es NIT. */
  nit_type: 'NIT';
  /** Razón social / nombre. */
  legal_name: string;
  person_type: 'NATURAL' | 'JURIDICA' | '';
  tax_regime: 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE' | '';
  /** Código CIIU de actividad principal (ej 4711). */
  ciiu: string;
  /** Dirección fiscal (línea). */
  fiscal_address: string;
  /** ISO-3166 alfa-2, siempre 'CO' para RUT colombiano. */
  country: string;
  /** Nombre del departamento (ej 'Cundinamarca'). */
  department: string;
  /** Nombre de la ciudad/municipio (ej 'Bogotá'). */
  city: string;
  /** SOLO códigos RUT: R-99-PN, O-13, O-15, O-23, O-47, R-99-PJ. */
  tax_responsibilities: string[];
  /** Responsabilidad principal del emisor, como código RUT. */
  tax_scheme: string;
  /** 0-100. */
  confidence: number;
  extraction_notes: string | null;
}

@Injectable()
export class RutScannerService {
  private readonly logger = new Logger(RutScannerService.name);

  constructor(private readonly aiEngine: AIEngineService) {}

  /**
   * Scans a Colombian RUT document (image or PDF) and returns normalized
   * fiscal identity data ready to pre-fill the legal/tax form.
   *
   * Mirrors `InvoiceScannerService.scanInvoice`: the file is preprocessed
   * (sharp resize for images, raw passthrough for PDFs) and sent as an
   * `image_url` data-uri so the vision model processes it natively.
   */
  async scanRutDocument(file: Express.Multer.File): Promise<RutScanResult> {
    this.logger.debug(
      `[RutScan] File: mimetype=${file.mimetype}, size=${file.size}, buffer=${file.buffer?.length ?? 'NO BUFFER'}`,
    );

    const { base64, mimeType } = await this.preprocessImage(file);
    const dataUri = `data:${mimeType};base64,${base64}`;

    this.logger.debug(`[RutScan] DataURI length: ${dataUri.length} chars`);

    const documentMessage: AIMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract the fiscal identity data from this Colombian RUT document (DIAN). Return ONLY the JSON object matching the schema defined in your system instructions.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    this.logger.debug(`[RutScan] Sending to AI engine...`);
    const response = await this.aiEngine.run('rut_scanner', {}, [
      documentMessage,
    ]);

    this.logger.debug(
      `[RutScan] AI response: success=${response.success}, contentLength=${response.content?.length ?? 0}, model=${response.model}, error=${response.error}`,
    );
    this.logger.debug(
      `[RutScan] AI content preview: ${response.content?.substring(0, 300)}`,
    );

    if (!response.success || !response.content) {
      this.logger.error(`AI RUT extraction failed: ${response.error}`);
      throw new VendixHttpException(ErrorCodes.RUT_SCAN_AI_FAIL);
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
      return this.normalizeRutResponse(parsed);
    } catch (err) {
      if (err instanceof VendixHttpException) throw err;
      this.logger.error(`Failed to parse AI RUT response: ${response.content}`);
      throw new VendixHttpException(ErrorCodes.RUT_SCAN_PARSE_FAIL);
    }
  }

  // --- Private helpers ---

  /**
   * Try to optimize images via sharp; on failure (e.g. PDFs, unsupported
   * formats) fall back to the raw buffer with its original mimetype. This is
   * what makes a PDF work: sharp throws → we send the raw PDF data-uri and the
   * vision model (Gemini 2.5 Flash) processes it natively.
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
        `[RutScan] Image preprocessed: ${file.size} bytes → ${processedBuffer.length} bytes (${metadata.width}x${metadata.height}${needsResize ? ' resized' : ''})`,
      );

      return {
        base64: processedBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      };
    } catch (err) {
      this.logger.warn(
        `[RutScan] Image preprocessing failed, using raw: ${err.message}`,
      );
      return {
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
      };
    }
  }

  private normalizeRutResponse(parsed: any): RutScanResult {
    const PERSON_TYPES = new Set(['NATURAL', 'JURIDICA']);
    const TAX_REGIMES = new Set([
      'COMUN',
      'SIMPLIFICADO',
      'GRAN_CONTRIBUYENTE',
    ]);

    const personType = String(parsed.person_type || '')
      .trim()
      .toUpperCase();
    const taxRegime = String(parsed.tax_regime || '')
      .trim()
      .toUpperCase();

    const responsibilities = Array.isArray(parsed.tax_responsibilities)
      ? parsed.tax_responsibilities
          .map((r: any) => String(r || '').trim())
          .filter((r: string) => r.length > 0)
      : [];

    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(100, confidence));

    return {
      nit: String(parsed.nit ?? '').trim(),
      nit_dv: String(parsed.nit_dv ?? '').trim(),
      nit_type: 'NIT',
      legal_name: String(parsed.legal_name ?? '').trim(),
      person_type: PERSON_TYPES.has(personType)
        ? (personType as 'NATURAL' | 'JURIDICA')
        : '',
      tax_regime: TAX_REGIMES.has(taxRegime)
        ? (taxRegime as 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE')
        : '',
      ciiu: String(parsed.ciiu ?? '').trim(),
      fiscal_address: String(parsed.fiscal_address ?? '').trim(),
      country: String(parsed.country ?? 'CO').trim().toUpperCase() || 'CO',
      department: String(parsed.department ?? '').trim(),
      city: String(parsed.city ?? '').trim(),
      tax_responsibilities: responsibilities,
      tax_scheme: String(parsed.tax_scheme ?? '').trim(),
      confidence,
      extraction_notes:
        parsed.extraction_notes != null && String(parsed.extraction_notes).trim()
          ? String(parsed.extraction_notes).trim()
          : null,
    };
  }
}
