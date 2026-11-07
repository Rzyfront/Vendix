import { createHash } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { S3Service } from '@common/services/s3.service';
import { WorkflowDefinitionV1, WorkflowFieldDef, findStage } from '@common/workflows/contract';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { AIMessage, AIMessageContentPart } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { parseAiJson } from '../../../../ai-engine/utils/ai-json.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { ReceivedDocumentPagesService } from '../../../received-documents/services/received-document-pages.service';
import { WorkflowInstancesService } from '../../workflows/instances/workflow-instances.service';
import { DossiersService } from '../dossiers.service';
import { StoredFilesService } from '../stored-files.service';
import { READABLE_FIELD_TYPES, normalizeDate, normalizeFieldValue } from './document-check-normalizers';
import {
  CheckFieldResult,
  CheckLegibility,
  CheckRegion,
  CheckVerdict,
  DocumentCheckResult,
  RequestedField,
} from './document-checks.types';

export const DOCUMENT_EXTRACT_APP_KEY = 'workflow_document_extract';
/** Keep in sync with the prompt header in `prisma/seeds/workflow-document-extract.application.ts`. */
export const DOCUMENT_EXTRACT_PROMPT_VERSION = 'v1';
export const LOW_CONFIDENCE = 0.75;
export const AI_TIMEOUT_MS = 120_000;
const MAX_TEXT_CHARS = 20_000;
const READABLE_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const MANAGE_PERMISSION = 'store:workflows:manage';
const TASK_PERMISSION = 'store:workflows:task';

export interface ReadDocumentInput {
  instance_id: number;
  field_keys: string[];
}

interface CheckRow {
  id: number;
  file_id: number;
  workflow_instance_id: number | null;
  check_type: string;
  status: string;
  app_key: string;
  model: string | null;
  prompt_version: string;
  input_sha256: string;
  result: unknown;
  verdict: CheckVerdict | null;
  tokens_used: number | null;
  error: string | null;
  requested_by_user_id: number | null;
  reviewed_by_user_id: number | null;
  reviewed_at: Date | null;
  created_at: Date;
}

function sha256(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\u0000');
  return h.digest('hex');
}

/** `pass` all good; `warn` fair legibility or low-confidence fields; `needs_review` mismatch or poor. */
export function verdictOf(result: DocumentCheckResult): CheckVerdict {
  if (result.legibility === 'poor' || result.matches_request === false) return 'needs_review';
  const lowConfidence = Object.values(result.fields).some((f) => f.confidence < LOW_CONFIDENCE);
  if (result.legibility === 'fair' || lowConfidence) return 'warn';
  return 'pass';
}

function clamp01(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
}

function regionOf(raw: unknown): CheckRegion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const [x, y, w, h] = [clamp01(r.x), clamp01(r.y), clamp01(r.w), clamp01(r.h)];
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, w, h };
}

/** Validates the AI JSON strictly and normalizes it by the requested fields; unknown keys are dropped. */
export function buildResult(
  parsed: unknown,
  requested: Array<RequestedField & { def: WorkflowFieldDef }>,
  pageCount: number,
): DocumentCheckResult {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VendixHttpException(ErrorCodes.DOCUMENT_CHECK_AI_FAILED);
  }
  const p = parsed as Record<string, unknown>;
  const legibility: CheckLegibility = ['good', 'fair', 'poor'].includes(p.legibility as string)
    ? (p.legibility as CheckLegibility)
    : 'fair';
  const rawFields =
    p.fields && typeof p.fields === 'object' && !Array.isArray(p.fields)
      ? (p.fields as Record<string, unknown>)
      : {};
  const fields: Record<string, CheckFieldResult> = {};
  const unread: string[] = [];
  for (const req of requested) {
    const entry = rawFields[req.key];
    const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    const value = e ? normalizeFieldValue(req.def, e.value) : null;
    if (value === null) {
      unread.push(req.key);
      continue;
    }
    const pageRaw = Number(e?.page);
    fields[req.key] = {
      value,
      confidence: clamp01(e?.confidence) ?? 0,
      page: Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= pageCount ? pageRaw : null,
      region: regionOf(e?.region),
    };
  }
  const reasons = Array.isArray(p.mismatch_reasons)
    ? p.mismatch_reasons
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map((r) => r.trim().slice(0, 300))
        .slice(0, 5)
    : [];
  const docType =
    typeof p.doc_type === 'string' && p.doc_type.trim()
      ? p.doc_type.trim().toLowerCase().slice(0, 60)
      : null;
  return {
    doc_type: docType,
    legibility,
    matches_request: typeof p.matches_request === 'boolean' ? p.matches_request : null,
    mismatch_reasons: reasons,
    valid_until: p.valid_until ? normalizeDate(p.valid_until) : null,
    text: typeof p.text === 'string' ? p.text.slice(0, MAX_TEXT_CHARS) : '',
    page_count: pageCount,
    fields,
    unread_keys: unread,
  };
}

/** API shape: the stored result without the (large) read text. */
export function serializeCheck(row: CheckRow, cached = false) {
  const { text: _text, ...result } = (row.result ?? {}) as Partial<DocumentCheckResult>;
  return {
    id: row.id,
    file_id: row.file_id,
    instance_id: row.workflow_instance_id,
    status: row.status,
    verdict: row.verdict,
    model: row.model,
    prompt_version: row.prompt_version,
    tokens_used: row.tokens_used,
    error: row.error,
    result,
    cached,
    reviewed_at: row.reviewed_at,
    reviewed_by_user_id: row.reviewed_by_user_id,
    created_at: row.created_at,
  };
}

/**
 * "Leer con IA": OCR with provenance + AI validation of a dossier file. The AI
 * call goes through `AIEngineService.run` inside the store context, so the
 * tokens are metered against the store's plan quota. A `done` check with the
 * same input hash is returned without calling the AI again.
 */
@Injectable()
export class DocumentChecksService {
  private readonly logger = new Logger(DocumentChecksService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly files: StoredFilesService,
    private readonly dossiers: DossiersService,
    private readonly instances: WorkflowInstancesService,
    private readonly ai: AIEngineService,
    private readonly pages: ReceivedDocumentPagesService,
    private readonly s3: S3Service,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id ?? null,
      allowed:
        !!c.is_owner ||
        !!c.is_super_admin ||
        (c.permissions ?? []).some((p) => p === MANAGE_PERMISSION || p === TASK_PERMISSION),
    };
  }

  /** The file must sit in the dossier of a request the caller can see (404 otherwise). */
  private async assertVisible(fileId: number, instanceId?: number): Promise<number[]> {
    const c = this.ctx();
    if (!c.allowed) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    await this.files.findOne(fileId);
    const owning = await this.dossiers.instanceIdsOfFile(fileId);
    const candidates = instanceId === undefined ? owning : owning.filter((i) => i === instanceId);
    const visible: number[] = [];
    for (const id of candidates) if (await this.instances.canSee(id)) visible.push(id);
    if (visible.length === 0) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    return visible;
  }

  /** Requested fields come from the request's definition (current stage form), never from the client. */
  private async resolveFields(instanceId: number, keys: string[]) {
    const c = this.ctx();
    const instance = await this.prisma.workflow_instances.findFirst({
      where: { id: instanceId, store_id: c.store_id },
    });
    if (!instance) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    const version = await this.prisma.workflow_versions.findFirst({
      where: { id: instance.version_id, store_id: c.store_id },
    });
    const definition = version?.definition as WorkflowDefinitionV1 | undefined;
    const stage = definition ? findStage(definition, instance.current_stage_key) : undefined;
    if (!definition || !stage) throw new VendixHttpException(ErrorCodes.DOCUMENT_CHECK_FIELDS_INVALID);
    const inForm = new Set(stage.form?.fields ?? []);
    const unique = [...new Set(keys)];
    const requested: Array<RequestedField & { def: WorkflowFieldDef }> = [];
    for (const key of unique) {
      const def = definition.fields.find((f) => f.key === key);
      if (!def || !inForm.has(key) || !READABLE_FIELD_TYPES.has(def.type) || def.compute) {
        throw new VendixHttpException(
          ErrorCodes.DOCUMENT_CHECK_FIELDS_INVALID,
          `El campo "${key}" no se puede llenar con IA en esta etapa.`,
        );
      }
      requested.push({ key, label: def.label, type: def.type, def });
    }
    requested.sort((a, b) => a.key.localeCompare(b.key));
    return {
      requested,
      context: {
        workflow: definition.name,
        stage: stage.name,
        title: (instance as { title?: string | null }).title ?? null,
      },
    };
  }

  async list(fileId: number) {
    const c = this.ctx();
    await this.assertVisible(fileId);
    const rows: CheckRow[] = await this.prisma.document_checks.findMany({
      where: { store_id: c.store_id, file_id: fileId },
      orderBy: { id: 'desc' },
      take: 20,
    });
    return rows.map((r) => serializeCheck(r));
  }

  async review(checkId: number) {
    const c = this.ctx();
    const check: CheckRow | null = await this.prisma.document_checks.findFirst({
      where: { id: checkId, store_id: c.store_id },
    });
    if (!check) throw new VendixHttpException(ErrorCodes.DOCUMENT_CHECK_NOT_FOUND);
    try {
      await this.assertVisible(check.file_id);
    } catch {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_CHECK_NOT_FOUND);
    }
    if (check.status !== 'done') {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_CHECK_NOT_FOUND);
    }
    if (!check.reviewed_at) {
      await this.prisma.document_checks.updateMany({
        where: { id: check.id, store_id: c.store_id, reviewed_at: null },
        data: { reviewed_by_user_id: c.user_id, reviewed_at: new Date() },
      });
    }
    const fresh: CheckRow | null = await this.prisma.document_checks.findFirst({
      where: { id: check.id, store_id: c.store_id },
    });
    return serializeCheck(fresh ?? check);
  }

  async read(fileId: number, input: ReadDocumentInput) {
    const c = this.ctx();
    await this.assertVisible(fileId, input.instance_id);
    const file = await this.files.findOne(fileId);
    const mime = file.mime_type.toLowerCase();
    if (!READABLE_MIMES.has(mime)) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_CHECK_FILE_UNSUPPORTED);
    }
    const { requested, context } = await this.resolveFields(input.instance_id, input.field_keys);

    const inputSha = sha256(
      file.sha256,
      DOCUMENT_EXTRACT_PROMPT_VERSION,
      JSON.stringify(requested.map((r) => [r.key, r.type, r.label])),
    );
    const hit: CheckRow | null = await this.prisma.document_checks.findFirst({
      where: {
        store_id: c.store_id,
        input_sha256: inputSha,
        prompt_version: DOCUMENT_EXTRACT_PROMPT_VERSION,
        status: 'done',
      },
      orderBy: { id: 'desc' },
    });
    if (hit) {
      const same: CheckRow | null =
        hit.file_id === fileId
          ? hit
          : await this.prisma.document_checks.create({
              data: {
                organization_id: c.organization_id,
                store_id: c.store_id,
                file_id: fileId,
                workflow_instance_id: input.instance_id,
                check_type: hit.check_type,
                status: 'done',
                app_key: hit.app_key,
                model: hit.model,
                prompt_version: hit.prompt_version,
                input_sha256: inputSha,
                result: hit.result,
                verdict: hit.verdict,
                tokens_used: null,
                requested_by_user_id: c.user_id,
              },
            });
      await this.fillProfile(fileId, (same ?? hit).result as DocumentCheckResult);
      return serializeCheck(same ?? hit, true);
    }

    // No vision model linked → fail before consuming anything.
    await this.ai.assertVisionModelLinked(DOCUMENT_EXTRACT_APP_KEY);

    const created: CheckRow = await this.prisma.document_checks.create({
      data: {
        organization_id: c.organization_id,
        store_id: c.store_id,
        file_id: fileId,
        workflow_instance_id: input.instance_id,
        check_type: 'extract',
        status: 'running',
        app_key: DOCUMENT_EXTRACT_APP_KEY,
        prompt_version: DOCUMENT_EXTRACT_PROMPT_VERSION,
        input_sha256: inputSha,
        result: {},
        requested_by_user_id: c.user_id,
      },
    });

    try {
      const bytes = await this.s3.downloadFile(file.s3_key);
      let prepared: Awaited<ReturnType<ReceivedDocumentPagesService['prepare']>>;
      try {
        prepared = await this.pages.prepare({
          buffer: bytes,
          mimetype: mime,
          size: bytes.length,
          originalname: file.original_name,
        });
      } catch (e) {
        if (e instanceof BadRequestException) {
          throw new VendixHttpException(ErrorCodes.DOCUMENT_CHECK_FILE_UNSUPPORTED, e.message);
        }
        throw e;
      }
      const response = await this.runWithTimeout(
        this.ai.run(DOCUMENT_EXTRACT_APP_KEY, {}, [this.buildMessage(prepared.pages, requested, context)]),
      );
      if (!response.success || !response.content) {
        this.logger.warn(`Document check ${created.id} failed: ${response.error ?? 'empty response'}`);
        throw new VendixHttpException(ErrorCodes.DOCUMENT_CHECK_AI_FAILED);
      }
      let parsed: unknown;
      try {
        parsed = parseAiJson(response.content);
      } catch {
        throw new VendixHttpException(ErrorCodes.DOCUMENT_CHECK_AI_FAILED);
      }
      const result = buildResult(parsed, requested, prepared.page_count);
      const verdict = verdictOf(result);
      await this.prisma.document_checks.updateMany({
        where: { id: created.id, store_id: c.store_id },
        data: {
          status: 'done',
          result: result as unknown as object,
          verdict,
          model: response.model ?? null,
          tokens_used: response.usage?.totalTokens ?? null,
          error: null,
        },
      });
      await this.fillProfile(fileId, result);
      const done: CheckRow | null = await this.prisma.document_checks.findFirst({
        where: { id: created.id, store_id: c.store_id },
      });
      return serializeCheck(done ?? created);
    } catch (e) {
      await this.prisma.document_checks.updateMany({
        where: { id: created.id, store_id: c.store_id },
        data: { status: 'failed', error: (e as Error).message.slice(0, 500) },
      });
      throw e;
    }
  }

  private runWithTimeout<T>(call: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new VendixHttpException(ErrorCodes.DOCUMENT_CHECK_AI_TIMEOUT)),
        AI_TIMEOUT_MS,
      );
    });
    return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
  }

  private buildMessage(
    pages: Array<{ page_number: number; data_uri: string }>,
    requested: RequestedField[],
    context: { workflow: string; stage: string; title: string | null },
  ): AIMessage {
    const fields = requested.map((r) => `- ${r.key} (${r.type}): ${r.label}`).join('\n');
    const content: AIMessageContentPart[] = [
      {
        type: 'text',
        text: [
          'REQUEST CONTEXT (what the document should be for):',
          `workflow: ${context.workflow}`,
          `stage: ${context.stage}`,
          ...(context.title ? [`title: ${context.title}`] : []),
          '',
          'REQUESTED FIELDS (use exactly these keys):',
          fields,
          '',
          `The document has ${pages.length} page(s), sent below in order. Return ONLY the JSON object defined in your instructions.`,
        ].join('\n'),
      },
    ];
    for (const page of pages) {
      content.push({ type: 'text', text: `Page ${page.page_number}:` });
      content.push({ type: 'image_url', image_url: { url: page.data_uri, detail: 'high' } });
    }
    return { role: 'user', content };
  }

  /** Fills the file profile with what the AI found; never overwrites what a person set. */
  private async fillProfile(fileId: number, result: Partial<DocumentCheckResult>) {
    const c = this.ctx();
    const found = {
      doc_type: result.doc_type ?? null,
      extracted_text: result.text?.trim() ? result.text : null,
      valid_until: result.valid_until ?? null,
    };
    if (!found.doc_type && !found.extracted_text && !found.valid_until) return;
    const profile = await this.prisma.document_file_profiles.findFirst({
      where: { store_id: c.store_id, file_id: fileId },
    });
    if (!profile) {
      await this.prisma.document_file_profiles.create({
        data: {
          store_id: c.store_id,
          file_id: fileId,
          doc_type: found.doc_type,
          extracted_text: found.extracted_text,
          valid_until: found.valid_until ? new Date(`${found.valid_until}T00:00:00.000Z`) : null,
        },
      });
      return;
    }
    const data: Record<string, unknown> = {};
    if (!profile.doc_type && found.doc_type) data.doc_type = found.doc_type;
    if (!profile.extracted_text && found.extracted_text) data.extracted_text = found.extracted_text;
    if (!profile.valid_until && found.valid_until) {
      data.valid_until = new Date(`${found.valid_until}T00:00:00.000Z`);
    }
    if (Object.keys(data).length === 0) return;
    await this.prisma.document_file_profiles.updateMany({
      where: { id: profile.id, store_id: c.store_id },
      data,
    });
  }
}
