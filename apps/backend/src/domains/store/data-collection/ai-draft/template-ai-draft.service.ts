import { Injectable, OnModuleInit } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { AiScanHandlerRegistry } from '@common/ai-scan-jobs/ai-scan-handler.registry';
import { AiScanJobService } from '@common/ai-scan-jobs/ai-scan-job.service';
import { classifyAiJobFailure } from '@common/ai-scan-jobs/ai-job-failure.util';
import type { AiUnavailableReason } from '@common/ai-scan-jobs/ai-job-failure.util';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { ReceivedDocumentPagesService } from '../../../received-documents/services/received-document-pages.service';
import { matchesDeclaredSignature } from '../utils/file-signature.util';
import type { TemplateJsonError } from '../template-json/template-json.contract';
import {
  TEMPLATE_BUILDER_APP_KEY,
  TemplateDraftResult,
  buildTemplateDraftFromFiles,
} from './template-ai-draft.builder';

export const TEMPLATE_DRAFT_SCAN_KIND = 'data_collection_template' as const;
/** Upload ceiling; the page preparation refuses anything larger too. */
export const TEMPLATE_DRAFT_MAX_BYTES = 10 * 1024 * 1024;
/** Formats the page preparation reads (HEIC is not one of them). */
export const TEMPLATE_DRAFT_MIMES: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
};

export interface TemplateDraftUpload {
  buffer?: Buffer;
  mimetype?: string;
  size?: number;
  originalname?: string;
}

export type TemplateAiDraftStatus =
  | { status: 'pending' }
  | { status: 'done'; json: unknown; errors: TemplateJsonError[] }
  | {
      status: 'failed';
      error_code: string | null;
      error_reason?: AiUnavailableReason;
      message: string;
    };

/** Spanish message for a failed draft, by the error code the worker stored. */
const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  DCOL_AI_001: 'El archivo no es un PDF o una imagen válida del formulario.',
  DCOL_AI_002: 'La IA no devolvió una plantilla legible. Prueba con una foto más nítida o con menos páginas.',
  DCOL_AI_003: 'El formulario es demasiado largo para generarlo de una vez. Prueba con menos páginas (máximo 3).',
  DCOL_AI_004: 'No pudimos leer las páginas del documento. Si es un PDF escaneado, sube una foto del formulario (JPG o PNG).',
};
const REASON_MESSAGES: Readonly<Record<AiUnavailableReason, string>> = {
  not_configured:
    'Tu tienda no tiene un modelo de IA con visión configurado para leer formularios. Pide al administrador que lo enlace en el panel de IA.',
  plan_quota: 'Se agotó la cuota de IA de tu plan. Amplía el plan o inténtalo más adelante.',
  credits: 'El servicio de IA no tiene créditos disponibles en este momento. Inténtalo más tarde.',
  rate_limited: 'El servicio de IA está ocupado. Espera un momento e inténtalo de nuevo.',
};
const GENERIC_FAILURE = 'No se pudo generar el borrador con IA. Inténtalo de nuevo.';

/**
 * Message that rejects an upload, or `null` when it is acceptable: one PDF,
 * JPG, PNG or WEBP of at most 10 MiB whose bytes match its declared type.
 */
export function checkTemplateDraftUpload(file: TemplateDraftUpload | undefined): string | null {
  if (!file?.buffer?.length) return 'Sube un PDF o una foto del formulario.';
  if (file.buffer.length > TEMPLATE_DRAFT_MAX_BYTES || (file.size ?? 0) > TEMPLATE_DRAFT_MAX_BYTES) {
    return 'El archivo debe pesar como máximo 10 MB.';
  }
  const mime = (file.mimetype ?? '').trim().toLowerCase();
  const extension = (file.originalname ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (mime === 'image/heic' || mime === 'image/heif' || extension === 'heic' || extension === 'heif') {
    return 'Las fotos HEIC no son compatibles. Expórtala como JPG o PNG e inténtalo de nuevo.';
  }
  const extensions = TEMPLATE_DRAFT_MIMES[mime];
  if (!extensions) return 'Formato no soportado. Sube un PDF, JPG, PNG o WEBP.';
  if (extension && !extensions.includes(extension)) {
    return 'La extensión del archivo no coincide con su tipo.';
  }
  if (!matchesDeclaredSignature(mime, extension, file.buffer)) {
    return 'El contenido del archivo no coincide con su tipo. Sube el PDF o la foto original.';
  }
  return null;
}

/** Maps the generic `ai-scan` job status to the draft status the web reads. */
export function toTemplateAiDraftStatus(status: {
  status: string;
  result?: unknown;
  error?: string;
}): TemplateAiDraftStatus {
  if (status.status === 'completed') {
    const result = (status.result ?? {}) as Partial<TemplateDraftResult>;
    return {
      status: 'done',
      json: result.json ?? null,
      errors: Array.isArray(result.errors) ? result.errors : [],
    };
  }
  if (status.status === 'failed') {
    const code = (status.error ?? '').trim();
    const knownCode = /^[A-Z][A-Z0-9_]*_\d{3}$/.test(code) ? code : null;
    const failure = classifyAiJobFailure(code);
    const message =
      (knownCode && FAILURE_MESSAGES[knownCode]) ||
      (failure.reason && REASON_MESSAGES[failure.reason]) ||
      GENERIC_FAILURE;
    return {
      status: 'failed',
      error_code: knownCode,
      ...(failure.reason ? { error_reason: failure.reason } : {}),
      message,
    };
  }
  return { status: 'pending' };
}

/**
 * «Crear plantilla con IA (PDF/foto)»: validates the upload, enqueues it on the
 * generic `ai-scan` queue and reads the draft back. The worker only runs
 * `buildTemplateDraftFromFiles`; nothing here writes templates or fields.
 */
@Injectable()
export class TemplateAiDraftService implements OnModuleInit {
  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly pages: ReceivedDocumentPagesService,
    private readonly registry: AiScanHandlerRegistry,
    private readonly jobs: AiScanJobService,
  ) {}

  onModuleInit(): void {
    this.registry.register<TemplateDraftResult>(TEMPLATE_DRAFT_SCAN_KIND, ({ files }) =>
      buildTemplateDraftFromFiles(files, { aiEngine: this.aiEngine, pages: this.pages }),
    );
  }

  async enqueue(file: TemplateDraftUpload | undefined): Promise<{ job_id: string }> {
    const problem = checkTemplateDraftUpload(file);
    if (problem) throw new VendixHttpException(ErrorCodes.DCOL_AI_001, problem);
    // Fail fast with a clear 409 instead of a queued job that cannot run.
    await this.aiEngine.assertVisionModelLinked(TEMPLATE_BUILDER_APP_KEY);
    const upload = file as Required<TemplateDraftUpload>;
    return this.jobs.enqueue(TEMPLATE_DRAFT_SCAN_KIND, [
      {
        buffer: upload.buffer,
        mimeType: upload.mimetype,
        originalName: upload.originalname || 'formulario',
        size: upload.buffer.length,
      },
    ]);
  }

  /** Same 404 for an unknown job, another user's/store's job or another kind. */
  async getStatus(jobId: string): Promise<TemplateAiDraftStatus> {
    const status = await this.jobs.getStatus(jobId);
    if (status.kind !== TEMPLATE_DRAFT_SCAN_KIND) {
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    }
    return toTemplateAiDraftStatus(status);
  }
}
