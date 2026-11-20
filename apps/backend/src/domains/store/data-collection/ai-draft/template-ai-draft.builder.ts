import { BadRequestException } from '@nestjs/common';
import { ErrorCodes, VendixHttpException, findErrorCodeEntry } from '@common/errors';
import type { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import type { AIMessage, AIMessageContentPart } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { parseAiJson } from '../../../../ai-engine/utils/ai-json.util';
import type { ReceivedDocumentPagesService } from '../../../received-documents/services/received-document-pages.service';
import {
  TEMPLATE_ENTITY_TYPES,
  TEMPLATE_FIELD_TYPES,
  TemplateJsonError,
  validateTemplateJson,
} from '../template-json/template-json.contract';
import { templateJsonSchemaText } from '../template-json/template-json.schema';

/** AI Engine application that drafts templates (seed + migration 20261220100000). */
export const TEMPLATE_BUILDER_APP_KEY = 'data_collection_template_builder';
/** Pages sent to the model: a form rarely needs more, and each page costs tokens. */
export const TEMPLATE_DRAFT_MAX_PAGES = 3;

const MAX_AI_CONTENT_BYTES = 1024 * 1024;
const MAX_REPAIR_ECHO_CHARS = 60_000;
const MAX_REPAIR_ERRORS = 50;
const MAX_JSON_DEPTH = 20;
const MAX_JSON_NODES = 50_000;

/** One uploaded file, as the `ai-scan` queue hands it over (`AiScanFile`). */
export interface TemplateDraftFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  size: number;
}

/** Collaborators of the extraction. No job state: the queue only calls it. */
export interface TemplateDraftContext {
  aiEngine: Pick<AIEngineService, 'run' | 'assertVisionModelLinked'>;
  pages: Pick<ReceivedDocumentPagesService, 'prepare'>;
}

/**
 * Draft produced by the AI. `errors` empty → `json` passed
 * `validateTemplateJson` (and is its normalized value). Otherwise `json` is the
 * model's best attempt and `errors` say what the user must fix by path.
 */
export interface TemplateDraftResult {
  json: unknown;
  errors: TemplateJsonError[];
}

const INSTRUCTION =
  'Build the data collection template for this form. Return ONLY the JSON object defined in your system instructions.';

/**
 * Pure extraction `(files, ctx) => { json, errors }`: prepares the pages
 * (native PDF text + page images, at most 3), asks the AI Engine for a
 * `vendix.data-collection-template/v1` JSON, validates it with the domain
 * validator and makes ONE repair call with the errors by path when needed.
 * Never writes templates or fields: the result is only a draft.
 */
export async function buildTemplateDraftFromFiles(
  files: TemplateDraftFile[],
  ctx: TemplateDraftContext,
): Promise<TemplateDraftResult> {
  const file = files?.[0];
  if (!file?.buffer?.length) {
    throw new VendixHttpException(ErrorCodes.DCOL_AI_001, 'Sube un PDF o una foto del formulario.');
  }

  await ctx.aiEngine.assertVisionModelLinked(TEMPLATE_BUILDER_APP_KEY);

  const variables = {
    template_schema: templateJsonSchemaText(),
    field_types: TEMPLATE_FIELD_TYPES.join(', '),
    entity_types: TEMPLATE_ENTITY_TYPES.join(', '),
  };
  const ask = (messages: AIMessage[]) => askModel(ctx, variables, messages);

  const first = await ask([await pagesMessage(file, ctx)]);
  const firstParsed = tryParse(first);

  if (firstParsed.ok) {
    const validation = validateTemplateJson(firstParsed.value);
    if (validation.ok) return { json: validation.value, errors: [] };

    // Keep the first draft if the repair cannot improve it: the user still
    // gets something to edit instead of a dry failure.
    let repaired: string;
    try {
      repaired = await ask([repairMessage(first, validation.errors)]);
    } catch {
      return { json: firstParsed.value, errors: validation.errors };
    }
    const repairedParsed = tryParse(repaired);
    if (!repairedParsed.ok) return { json: firstParsed.value, errors: validation.errors };
    return toResult(repairedParsed.value);
  }

  const repaired = await ask([repairMessage(first, [{ path: '', message: `Invalid JSON: ${firstParsed.reason}` }])]);
  const repairedParsed = tryParse(repaired);
  if (!repairedParsed.ok) throw new VendixHttpException(ErrorCodes.DCOL_AI_002);
  return toResult(repairedParsed.value);
}

function toResult(value: unknown): TemplateDraftResult {
  const validation = validateTemplateJson(value);
  return validation.ok ? { json: validation.value, errors: [] } : { json: value, errors: validation.errors };
}

async function pagesMessage(file: TemplateDraftFile, ctx: TemplateDraftContext): Promise<AIMessage> {
  let prepared: Awaited<ReturnType<TemplateDraftContext['pages']['prepare']>>;
  try {
    prepared = await ctx.pages.prepare({
      buffer: file.buffer,
      mimetype: file.mimeType,
      size: file.size,
      originalname: file.originalName,
    });
  } catch (error) {
    const detail = error instanceof BadRequestException ? ` ${error.message}` : '';
    throw new VendixHttpException(
      ErrorCodes.DCOL_AI_004,
      `No pudimos leer las páginas del documento.${detail} Si es un PDF escaneado, sube una foto del formulario (JPG o PNG).`,
    );
  }
  const pages = prepared.pages.slice(0, TEMPLATE_DRAFT_MAX_PAGES);
  if (!pages.length) {
    throw new VendixHttpException(
      ErrorCodes.DCOL_AI_004,
      'El documento no tiene páginas legibles. Sube una foto del formulario (JPG o PNG).',
    );
  }

  const content: AIMessageContentPart[] = [{ type: 'text', text: INSTRUCTION }];
  if (prepared.page_count > pages.length) {
    content.push({
      type: 'text',
      text: `Only the first ${pages.length} of ${prepared.page_count} pages are attached.`,
    });
  }
  for (const page of pages) {
    const text = page.text.trim();
    content.push({
      type: 'text',
      text: `Page ${page.page_number}.${text ? ` Text extracted from the PDF:\n${text}` : ' No extracted text: read the image.'}`,
    });
    content.push({ type: 'image_url', image_url: { url: page.data_uri, detail: 'high' } });
  }
  return { role: 'user', content };
}

function repairMessage(previous: string, errors: TemplateJsonError[]): AIMessage {
  const echo = previous.length > MAX_REPAIR_ECHO_CHARS ? `${previous.slice(0, MAX_REPAIR_ECHO_CHARS)}…` : previous;
  const list = errors
    .slice(0, MAX_REPAIR_ERRORS)
    .map((e) => `- ${e.path || '(root)'}: ${e.message}`)
    .join('\n');
  return {
    role: 'user',
    content:
      'Your previous answer is not a valid vendix.data-collection-template/v1 JSON. ' +
      'Fix ONLY these errors (by JSON path), keep every other section and field as it is, ' +
      'and return ONLY the corrected JSON object.\n\n' +
      `ERRORS:\n${list}\n\nPREVIOUS ANSWER:\n${echo}`,
  };
}

async function askModel(
  ctx: TemplateDraftContext,
  variables: Record<string, string>,
  messages: AIMessage[],
): Promise<string> {
  const response = await ctx.aiEngine.run(TEMPLATE_BUILDER_APP_KEY, variables, messages);
  if (!response?.success) {
    const code = response?.error_code;
    const known = code ? findErrorCodeEntry(code) : undefined;
    if (known) throw new VendixHttpException(known);
    throw new VendixHttpException(ErrorCodes.DCOL_AI_005);
  }
  if (response.finish_reason === 'length') throw new VendixHttpException(ErrorCodes.DCOL_AI_003);
  const content = typeof response.content === 'string' ? response.content : '';
  if (Buffer.byteLength(content, 'utf8') > MAX_AI_CONTENT_BYTES) throw new VendixHttpException(ErrorCodes.DCOL_AI_003);
  return content;
}

function tryParse(content: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (!content.trim()) return { ok: false, reason: 'empty answer' };
  try {
    const value = parseAiJson(content);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: 'the answer is not a JSON object' };
    }
    if (!isBounded(value)) return { ok: false, reason: 'the JSON is too deep or too large' };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'unparseable' };
  }
}

function isBounded(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (++visited > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) return false;
    if (!current.value || typeof current.value !== 'object') continue;
    const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}
