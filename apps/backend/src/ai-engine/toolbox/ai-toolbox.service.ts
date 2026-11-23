import { Injectable, Logger } from '@nestjs/common';
import { AIEngineService } from '../ai-engine.service';
import { AIMessage } from '../interfaces/ai-provider.interface';
// ia-cargas F5a: the shared page/image preparation, imported as a plain class
// (it has no injected dependencies). Never `AiIngestModule`: its extraction
// service depends on `AIEngineService`, which lives in this @Global() module.
import {
  AiDocumentPage,
  DocumentPagesService,
} from '../../common/ai-ingest/documents/document-pages.service';
import { pagesMessageContent } from '../../common/ai-ingest/documents/page-content';
import { detectIngestFile } from '../../common/ai-ingest/ingest-file.detector';
import { decodeDataUri } from '../../common/ai-ingest/documents/queued-document';
import { parseAiJson } from '../utils/ai-json.util';
import { VexiAttachmentsService } from '../../domains/store/vexi/vexi-attachments.service';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../common/errors';

/**
 * Document kind, in the vocabulary of the person using the system, mapped to
 * the AI application that knows how to read it.
 *
 * The keys are Spanish because the model picks one from a conversation held in
 * Spanish, and every mismatch between what the user says and what the enum
 * accepts is a turn spent guessing. The values are the `ai_engine_applications`
 * rows that already exist with their own extraction prompt and their own vision
 * config (`VISION_APP_KEYS` in `ai-engine-apps.seed.ts`).
 */
export const DOCUMENT_KIND_TO_APP: Record<string, string> = {
  factura_compra: 'invoice_ocr',
  factura_insumos: 'invoice_ocr_ingredient',
  comprobante_pago: 'payment_receipt_ocr',
  factura_gasto: 'expense_invoice_ocr',
  reconteo_inventario: 'inventory_count_ocr',
  rut: 'rut_scanner',
  planilla_ruta: 'route_sheet_ocr',
  padron_socios: 'member_roster_ocr',
};

/** What each extraction is for, so the tool description can teach the model. */
export const DOCUMENT_KIND_PURPOSE: Record<string, string> = {
  factura_compra: 'factura de un proveedor para registrar una orden de compra',
  factura_insumos:
    'factura de insumos, con presentación y contenido por empaque',
  comprobante_pago: 'comprobante de un pago o transferencia',
  factura_gasto: 'factura o recibo de un gasto del negocio',
  reconteo_inventario: 'planilla de conteo físico de inventario',
  rut: 'RUT para la identidad fiscal del comercio',
  planilla_ruta: 'planilla de una ruta de reparto con su recaudo',
  padron_socios: 'listado de socios para carga masiva de membresías',
};

export const SUMMARY_KIND_TO_APP: Record<string, string> = {
  cierre_caja: 'cash_register_closing_summary',
  historial_cliente: 'customer_history_summary',
  prediagnostico: 'consultation_prediagnosis',
};

export const COPY_KIND_TO_APP: Record<string, string> = {
  post_anuncio: 'marketing_ad_post_copywriter',
  prompt_anuncio: 'marketing_ad_prompt_specialist',
};

export const IMAGE_KIND_TO_APP: Record<string, string> = {
  anuncio: 'marketing_ad_image_generator',
  producto: 'product_image_enhancer',
};

/** Pages of one document Vexi hands to a specialist (plan ia-cargas D1). */
const MAX_DOCUMENT_PAGES = 10;
/** Same cap as a Vexi attachment (`VexiAttachmentsService`). */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface ExtractionOutcome {
  app_key: string;
  document: string;
  data: unknown;
  raw_length: number;
}

/**
 * Vexi's specialists.
 *
 * Every entry in `ai_engine_applications` becomes callable by the orchestrating
 * agent through this service, and that is the whole point of the design: the
 * conversational model reasons and decides, but it never reads a document
 * itself. It hands over an attachment handle, a purpose-built application runs
 * on a vision-capable config with its own extraction prompt, and what comes back
 * into the conversation is structured JSON.
 *
 * Three consequences worth stating because they are the reason for the shape:
 *
 *  - **Cost and context stay bounded.** A ten-page invoice costs one specialist
 *    call, not ten pages of tokens carried through every later turn of the chat.
 *  - **Provider independence.** The orchestrator does not need vision; only the
 *    specialist config does. Swapping the chat model cannot break scanning.
 *  - **Every call is metered.** Invocation goes through `AIEngineService.run()`
 *    / `runImage()`, the only paths that enforce the subscription gate, apply the
 *    rate limit and write an `ai_engine_logs` row. `chat()` would skip all three
 *    and the store would scan for free, off the books.
 *
 * `runByApplicationType` is deliberately NOT used: it drops `extraMessages` for
 * image-typed apps, which is exactly where the document lives.
 */
@Injectable()
export class AiToolboxService {
  private readonly logger = new Logger(AiToolboxService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly attachments: VexiAttachmentsService,
    private readonly prisma: StorePrismaService,
    private readonly documentPages: DocumentPagesService,
  ) {}

  /**
   * Runs the extraction application that matches the document kind.
   *
   * `retryHint` is what makes this a feedback loop rather than a one-shot OCR:
   * when the orchestrator validates the extraction against real data and finds a
   * contradiction (a total that does not match the lines, an unreadable field,
   * a supplier that does not exist), it calls again with the correction in plain
   * language and the specialist gets a second, better-informed pass.
   */
  async extractDocument(params: {
    attachmentId: string;
    documentKind: string;
    retryHint?: string;
    currencyHint?: string;
  }): Promise<ExtractionOutcome> {
    const appKey = DOCUMENT_KIND_TO_APP[params.documentKind];

    if (!appKey) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        `No sé leer documentos del tipo "${params.documentKind}". Los que puedo leer son: ${Object.keys(DOCUMENT_KIND_TO_APP).join(', ')}.`,
      );
    }

    const attachment = await this.attachments.dataUri(params.attachmentId);
    const pages = await this.prepareForVision(
      attachment.dataUri,
      attachment.mimeType,
      attachment.originalName,
    );

    const instruction = [
      'Extrae todos los datos de este documento y devuelve ÚNICAMENTE el objeto JSON del esquema definido en tus instrucciones de sistema.',
      params.currencyHint ? `\n\n${params.currencyHint}` : '',
      params.retryHint
        ? `\n\nCORRECCIÓN DE UN INTENTO ANTERIOR — presta especial atención a esto: ${params.retryHint}`
        : '',
    ].join('');

    // Every page travels in ONE call (the specialist sees the whole
    // document): native PDF text as text, scans and photos as images.
    const documentMessage: AIMessage = {
      role: 'user',
      content: pagesMessageContent(instruction, pages),
    };

    this.logger.log(
      `Toolbox extraction: app=${appKey} attachment=${params.attachmentId} pages=${pages.length} retry=${params.retryHint ? 'yes' : 'no'}`,
    );

    const response = await this.aiEngine.run(appKey, {}, [documentMessage]);

    if (!response.success || !response.content) {
      throw new VendixHttpException(
        ErrorCodes.INV_SCAN_AI_FAIL,
        'No pude leer el documento. Puede estar borroso o cortado.',
      );
    }

    await this.attachments.markConsumed(params.attachmentId, appKey);

    // Parsing and reporting are kept apart on purpose, same doctrine as
    // `InvoiceScannerService`: a reply that parsed fine but omitted a field is a
    // different problem from a reply that is not JSON, and conflating them sends
    // the orchestrator retrying the wrong thing.
    let data: unknown;
    try {
      data = parseAiJson(response.content);
    } catch (error: any) {
      throw new VendixHttpException(
        ErrorCodes.INV_SCAN_PARSE_FAIL,
        `La lectura del documento no vino en un formato aprovechable (${error?.message ?? 'JSON inválido'}). Vuelve a intentarlo con una pista más concreta.`,
      );
    }

    return {
      app_key: appKey,
      document: attachment.originalName,
      data,
      raw_length: response.content.length,
    };
  }

  /** Text-generation specialists: summaries and pre-diagnoses. */
  async summarize(
    summaryKind: string,
    variables: Record<string, string>,
  ): Promise<{ app_key: string; content: string }> {
    const appKey = SUMMARY_KIND_TO_APP[summaryKind];

    if (!appKey) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        `No tengo un resumen de tipo "${summaryKind}". Los que tengo son: ${Object.keys(SUMMARY_KIND_TO_APP).join(', ')}.`,
      );
    }

    const response = await this.aiEngine.run(appKey, variables);

    if (!response.success || !response.content) {
      throw new VendixHttpException(
        ErrorCodes.AI_REQUEST_001,
        'No pude preparar ese resumen.',
      );
    }

    return { app_key: appKey, content: response.content };
  }

  /** Copywriting specialists for marketing surfaces. */
  async writeCopy(
    copyKind: string,
    variables: Record<string, string>,
  ): Promise<{ app_key: string; content: string }> {
    const appKey = COPY_KIND_TO_APP[copyKind];

    if (!appKey) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        `No tengo un redactor de tipo "${copyKind}". Los que tengo son: ${Object.keys(COPY_KIND_TO_APP).join(', ')}.`,
      );
    }

    const response = await this.aiEngine.run(appKey, variables);

    if (!response.success || !response.content) {
      throw new VendixHttpException(
        ErrorCodes.AI_REQUEST_001,
        'No pude redactar ese texto.',
      );
    }

    return { app_key: appKey, content: response.content };
  }

  /**
   * Image specialists.
   *
   * Returns the base64 payload to the caller, never to the conversation: the
   * tool wrapper uploads it and hands the model a URL. A base64 image inside a
   * tool result would blow the context window in one call.
   */
  async generateImage(params: {
    imageKind: string;
    prompt: string;
    referenceAttachmentId?: string;
    productName?: string;
    extraContext?: Record<string, unknown>;
  }): Promise<{ app_key: string; imageBase64: string; revisedPrompt?: string }> {
    const appKey = IMAGE_KIND_TO_APP[params.imageKind];

    if (!appKey) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        `No sé generar imágenes de tipo "${params.imageKind}". Puedo: ${Object.keys(IMAGE_KIND_TO_APP).join(', ')}.`,
      );
    }

    const referenceImages = params.referenceAttachmentId
      ? [
          {
            url: (await this.attachments.dataUri(params.referenceAttachmentId))
              .dataUri,
            detail: 'high' as const,
          },
        ]
      : undefined;

    const response = await this.aiEngine.runImage(
      appKey,
      {
        requested_improvement: params.prompt,
        product_name: params.productName ?? '',
        product_type: '',
        description: '',
        context: JSON.stringify(params.extraContext ?? {}),
      },
      {
        action: referenceImages ? 'edit' : 'generate',
        quality: 'high',
        outputFormat: 'png',
        size: 'auto',
        ...(referenceImages
          ? { inputFidelity: 'high' as const, referenceImages }
          : {}),
      },
    );

    if (!response.success || !response.imageBase64) {
      throw new VendixHttpException(
        ErrorCodes.AI_REQUEST_001,
        'No pude generar la imagen.',
      );
    }

    return {
      app_key: appKey,
      imageBase64: response.imageBase64,
      revisedPrompt: response.revisedPrompt,
    };
  }

  /**
   * The attachment as pages for the vision specialist (ia-cargas F5a), with
   * the shared ai-ingest preparation instead of a private sharp copy:
   *
   * - A photo is straightened (EXIF) and reduced to a 1536 px JPEG, as before.
   * - A PDF is read page by page: native text as text, scanned pages rendered
   *   as images. It never travels raw (most vision configs reject it).
   * - Anything that is not a PDF or a photo, an unreadable PDF or one longer
   *   than 10 pages fails with an `AI_INGEST_*` error the orchestrator can
   *   explain to the user, instead of a model call that cannot succeed.
   *
   * `DocumentPagesService` is a plain provider of this module (no injected
   * dependencies), so the old reason for the copy — importing a domain
   * service into this @Global() module would close a cycle — no longer holds.
   */
  private async prepareForVision(
    dataUri: string,
    mimeType: string,
    originalName?: string,
  ): Promise<AiDocumentPage[]> {
    const decoded = decodeDataUri(dataUri);
    const detected = decoded
      ? detectIngestFile({ buffer: decoded.buffer, mimeType, originalName })
      : null;
    if (!decoded || !detected || detected.kind === 'sheet') {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_INVALID_FILE,
        'El adjunto no es un PDF ni una foto (JPG, PNG o WebP) que se pueda leer.',
      );
    }
    const prepared = await this.documentPages.prepareForAi(
      {
        buffer: decoded.buffer,
        mimetype: detected.mime,
        size: decoded.buffer.length,
        originalname: originalName ?? 'documento',
      },
      {
        maxPages: MAX_DOCUMENT_PAGES,
        maxBytes: MAX_DOCUMENT_BYTES,
        // ONE image per photo, as before: strips are for list loads.
        splitTallImages: false,
      },
    );
    return prepared.pages;
  }

  // ── Cross-checking against real records ─────────────────────────────────
  //
  // Mudados desde `ai-toolbox.tools.ts` en el paso 15 (cero `prisma.` en
  // tools). Viven aquí y no en los servicios de dominio porque la familia se
  // registra desde el `@Global()` ai-engine module: importar
  // `InvoiceScannerService` (purchase-orders) cerraría un ciclo de
  // dependencias. El matching es deliberadamente simple —exacto y por
  // prefijo, sin fuzzy scoring— porque su trabajo es decir la verdad sobre
  // lo que existe, y un fuzzy presentado como match es el modo de fallo que
  // hay que evitar. Lecturas puras, scopeadas por tienda/organización.

  /**
   * Cruza el proveedor leído contra `suppliers` (por NIT, luego nombre
   * exacto, luego candidatos por primera palabra). `state: { not: archived }`
   * en cada rama, igual que `InvoiceScannerService.matchSupplier`: sugerir un
   * proveedor archivado llevaría a abrirle una orden de compra.
   */
  async matchExtractionSupplier(params: {
    organizationId: number | undefined;
    name?: string;
    taxId?: string;
  }) {
    const { organizationId, name, taxId } = params;
    if (!organizationId) {
      return { matched: false, reason: 'Sin organización en contexto.' };
    }

    if (taxId) {
      const byTaxId = await this.prisma.suppliers.findFirst({
        where: {
          tax_id: { equals: taxId, mode: 'insensitive' },
          state: { not: 'archived' },
        },
        select: { id: true, name: true, tax_id: true },
      });
      if (byTaxId) return { matched: true, ...byTaxId, matched_by: 'tax_id' };
    }

    if (!name) return { matched: false };

    const exact = await this.prisma.suppliers.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        state: { not: 'archived' },
      },
      select: { id: true, name: true, tax_id: true },
    });
    if (exact) return { matched: true, ...exact, matched_by: 'name' };

    const candidates = await this.prisma.suppliers.findMany({
      where: {
        name: { contains: firstWord(name), mode: 'insensitive' },
        state: { not: 'archived' },
      },
      select: { id: true, name: true, tax_id: true },
      take: MAX_EXTRACTION_CANDIDATES,
    });

    return {
      matched: false,
      read_as: name,
      candidates,
      note: candidates.length
        ? 'Ninguno coincide exactamente. Pregúntale a la persona si es uno de estos.'
        : 'Ese proveedor no existe en el sistema.',
    };
  }

  /** Cruza líneas del documento contra `products` (código, nombre, candidatos). */
  async matchExtractionItems(items: any[]) {
    const results: unknown[] = [];

    for (const item of items.slice(0, 60)) {
      const description = String(item?.description ?? '').trim();
      const code = item?.code ? String(item.code).trim() : '';

      if (code) {
        const byCode = await this.prisma.products.findFirst({
          where: {
            OR: [{ sku: code }, { barcode: code }],
            state: { not: 'archived' },
          },
          select: { id: true, name: true, sku: true },
        });
        if (byCode) {
          results.push({
            read_as: description || code,
            matched: true,
            ...byCode,
            matched_by: 'code',
          });
          continue;
        }
      }

      if (!description) {
        results.push({ read_as: code, matched: false });
        continue;
      }

      const exact = await this.prisma.products.findFirst({
        where: {
          name: { equals: description, mode: 'insensitive' },
          state: { not: 'archived' },
        },
        select: { id: true, name: true, sku: true },
      });
      if (exact) {
        results.push({
          read_as: description,
          matched: true,
          ...exact,
          matched_by: 'name',
        });
        continue;
      }

      const candidates = await this.prisma.products.findMany({
        where: {
          name: { contains: firstWord(description), mode: 'insensitive' },
          state: { not: 'archived' },
        },
        select: { id: true, name: true, sku: true },
        take: MAX_EXTRACTION_CANDIDATES,
      });

      results.push({ read_as: description, matched: false, candidates });
    }

    return results;
  }

  /**
   * Cruza documentos de identidad contra personas de ESTA tienda.
   *
   * El predicado de tienda no es decoración: `StorePrismaService.users`
   * devuelve el delegado SIN scope (modelo de organización), así que un
   * `findFirst` pelado sobre `document_number` contestaría con una persona de
   * otro tenant —filtrando que el documento existe y su nombre. Mismo
   * predicado que `customers.tools.ts` propaga en cada consulta, por la misma
   * razón.
   */
  async matchExtractionPeople(documents: any[], storeId: number | undefined) {
    const results: unknown[] = [];

    if (!storeId) {
      return [{ matched: false, reason: 'Sin tienda en contexto.' }];
    }

    for (const raw of documents.slice(0, 60)) {
      const document = String(raw ?? '').trim();
      if (!document) continue;

      const found = await this.prisma.users.findFirst({
        where: {
          document_number: document,
          store_users: { some: { store_id: storeId } },
        },
        select: { id: true, first_name: true, last_name: true },
      });

      results.push(
        found
          ? {
              document,
              matched: true,
              id: found.id,
              name: `${found.first_name} ${found.last_name ?? ''}`.trim(),
            }
          : { document, matched: false },
      );
    }

    return results;
  }

  /** Categorías de gasto para cruzar extracciones del dominio `gastos`. */
  async listExpenseCategoriesForExtraction() {
    return this.prisma.expense_categories.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 40,
    });
  }
}

/** How many candidate matches are worth showing per unmatched line. */
const MAX_EXTRACTION_CANDIDATES = 3;

/**
 * The longest leading token of a name, used as the `contains` needle.
 *
 * Beats using the whole string: OCR routinely mangles the tail of a product
 * name ("Coca Cola 1.5L x12" → "Coca Cola 1.5Lx12"), while the head survives.
 */
function firstWord(value: string): string {
  const parts = value.split(/\s+/).filter((part) => part.length > 2);
  return (parts[0] ?? value).slice(0, 24);
}
