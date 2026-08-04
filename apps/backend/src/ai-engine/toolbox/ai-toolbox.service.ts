import { Injectable, Logger } from '@nestjs/common';
import sharp = require('sharp');
import { AIEngineService } from '../ai-engine.service';
import { AIMessage } from '../interfaces/ai-provider.interface';
import { parseAiJson } from '../utils/ai-json.util';
import { VexiAttachmentsService } from '../../domains/store/vexi/vexi-attachments.service';
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

/** sharp target, identical to `InvoiceScannerService.prepareImage`. */
const MAX_DIMENSION = 1536;
const JPEG_QUALITY = 85;

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
    const prepared = await this.prepareForVision(
      attachment.dataUri,
      attachment.mimeType,
    );

    const instruction = [
      'Extrae todos los datos de este documento y devuelve ÚNICAMENTE el objeto JSON del esquema definido en tus instrucciones de sistema.',
      params.currencyHint ? `\n\n${params.currencyHint}` : '',
      params.retryHint
        ? `\n\nCORRECCIÓN DE UN INTENTO ANTERIOR — presta especial atención a esto: ${params.retryHint}`
        : '',
    ].join('');

    const documentMessage: AIMessage = {
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        {
          type: 'image_url',
          image_url: { url: prepared, detail: 'high' },
        },
      ],
    };

    this.logger.log(
      `Toolbox extraction: app=${appKey} attachment=${params.attachmentId} retry=${params.retryHint ? 'yes' : 'no'}`,
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
   * Shrinks a photo before it reaches the vision model.
   *
   * Mirrors `InvoiceScannerService.prepareImage` rather than importing it: that
   * service belongs to the purchase-orders module, and pulling it into the
   * `@Global()` ai-engine module would close a dependency cycle. Duplicating
   * ~15 lines of sharp pipeline is the cheaper trade, and the constants are
   * documented as a mirror so they get changed together.
   *
   * A PDF (or anything sharp cannot decode) is forwarded untouched — the
   * specialist configs accept it and the failure mode of guessing here would be
   * a corrupted document.
   */
  private async prepareForVision(
    dataUri: string,
    mimeType: string,
  ): Promise<string> {
    if (!mimeType.startsWith('image/')) return dataUri;

    const base64 = dataUri.slice(dataUri.indexOf(',') + 1);

    try {
      const buffer = Buffer.from(base64, 'base64');
      const metadata = await sharp(buffer).metadata();
      const needsResize =
        (metadata.width ?? 0) > MAX_DIMENSION ||
        (metadata.height ?? 0) > MAX_DIMENSION;

      let pipeline = sharp(buffer);
      if (needsResize) {
        pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      const processed = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
      return `data:image/jpeg;base64,${processed.toString('base64')}`;
    } catch (error: any) {
      this.logger.warn(
        `Vision preprocessing failed (${error?.message}); sending the original.`,
      );
      return dataUri;
    }
  }
}
