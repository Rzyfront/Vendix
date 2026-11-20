import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import {
  AIMessage,
  AIResponse,
} from '../../../ai-engine/interfaces/ai-provider.interface';
import { parseAiJson } from '../../../ai-engine/utils/ai-json.util';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { chunk, mapWithConcurrency } from './batching';

/** JSON Schema node (the subset ai-ingest writes). */
export type JsonSchema = Record<string, unknown>;

export interface ExtractionSchema {
  /** `^[a-zA-Z0-9_-]{1,64}$`; travels as `json_schema.name`. */
  name: string;
  /**
   * Lenient schema used by ajv: only truly required keys in `required`, so a
   * model that omits empty fields (as the app prompts ask) still validates.
   * The provider gets its strict form ({@link toStrictJsonSchema}).
   */
  schema: JsonSchema;
}

export type AiExtractionFailure =
  /** `finish_reason === 'length'`: the answer was cut. */
  | 'truncated'
  /** Not JSON or not matching the schema, even after the repair attempt. */
  | 'invalid'
  /** The provider did not answer (credits, rate limit, outage). */
  | 'ai_failed';

export class AiExtractionError extends Error {
  constructor(
    readonly failure: AiExtractionFailure,
    message: string,
    readonly response?: AIResponse,
  ) {
    super(message);
    this.name = 'AiExtractionError';
  }

  /**
   * What a job handler throws. Document-side failures are 4xx (the ai-scan
   * queue turns them into `UnrecoverableError`: repeating the same input
   * gives the same answer at double cost); a provider failure stays 5xx/429
   * so BullMQ retries it.
   */
  toHttpException(): VendixHttpException {
    if (this.failure === 'truncated') {
      return new VendixHttpException(ErrorCodes.AI_INGEST_INCOMPLETE);
    }
    if (this.failure === 'invalid') {
      return new VendixHttpException(ErrorCodes.AI_INGEST_PARSE_FAIL);
    }
    if (this.response?.failure_reason === 'credits') {
      return new VendixHttpException(ErrorCodes.AI_PROVIDER_003);
    }
    if (this.response?.failure_reason === 'rate_limited') {
      return new VendixHttpException(ErrorCodes.AI_PROVIDER_004);
    }
    return new VendixHttpException(ErrorCodes.AI_REQUEST_001);
  }
}

/**
 * Quota key shared by every provider call of ONE load (mapping, batches,
 * repairs, splits). `async_queue` dedupes on `<request id>:<quotaKey>`, so a
 * load charges one unit, as the single call did before ai-ingest.
 */
export function newIngestQuotaKey(): string {
  return `ai-ingest:${randomUUID()}`;
}

export interface ExtractOptions {
  appKey: string;
  schema: ExtractionSchema;
  messages: AIMessage[];
  /** Share it across the calls of one load; default: one key per `extract`. */
  quotaKey?: string;
  /**
   * Template variables of the app prompt (`{{name}}` in its system prompt),
   * e.g. the consolidated JSON a revalidation compares against. Default none.
   */
  variables?: Record<string, string>;
  /**
   * `ai_engine_logs.attempt` of the first call (the repair logs +1). Batches
   * pass 1 + split depth. Log-only: it never changes the call. Default 1.
   */
  attempt?: number;
}

export interface ExtractBatchesOptions<TItem> {
  appKey: string;
  schema: ExtractionSchema;
  items: readonly TItem[];
  /** Items per call (rows for sheets). */
  batchSize: number;
  /** Calls in flight at once. Default 3. */
  concurrency?: number;
  /** How many times a truncated batch may be halved. Default 3. */
  maxSplitDepth?: number;
  buildMessages: (batch: TItem[]) => AIMessage[];
  /** Share it across the calls of one load; default: one key per run. */
  quotaKey?: string;
  /** Real progress: items finished (ok or failed) out of `items.length`. */
  onProgress?: (done: number, total: number) => Promise<void> | void;
  /** Template variables of the app prompt, the same for every batch. */
  variables?: Record<string, string>;
}

export interface ExtractedBatch<TItem, TOut> {
  items: TItem[];
  data: TOut;
}

export interface FailedBatch<TItem> {
  items: TItem[];
  failure: Exclude<AiExtractionFailure, 'ai_failed'>;
  message: string;
}

export interface ExtractBatchesResult<TItem, TOut> {
  results: ExtractedBatch<TItem, TOut>[];
  /** Batches the model could not answer validly; their items go to `skipped`. */
  failed: FailedBatch<TItem>[];
}

const MAX_ECHO_CHARS = 20_000;

/** Fixed text for a non-JSON answer: the parser message may echo model text. */
export const NOT_JSON_LOG_ERROR = 'not_json: the answer is not valid JSON';

type CheckResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[]; logError: string };

/**
 * Removes object keys whose value is `null`, at any depth (array items stay).
 * Strict structured output answers optional fields with `null`; the lenient
 * schema ajv uses treats them as absent, as the old hand-written parser did.
 */
export function dropNullKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNullKeys);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (inner !== null) out[key] = dropNullKeys(inner);
  }
  return out;
}
const MAX_ERRORS_SHOWN = 12;

/**
 * Converts a lenient schema to the strict form OpenAI `json_schema` requires:
 * every object lists all its properties in `required`, forbids extra keys and
 * makes the formerly optional ones nullable.
 */
export function toStrictJsonSchema(node: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...node };
  const properties = node.properties as Record<string, JsonSchema> | undefined;
  if (properties) {
    const required = new Set((node.required as string[] | undefined) ?? []);
    const strictProps: Record<string, JsonSchema> = {};
    for (const [key, child] of Object.entries(properties)) {
      const strictChild = toStrictJsonSchema(child);
      strictProps[key] = required.has(key)
        ? strictChild
        : nullable(strictChild);
    }
    out.properties = strictProps;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  if (node.items && typeof node.items === 'object') {
    out.items = toStrictJsonSchema(node.items as JsonSchema);
  }
  return out;
}

function nullable(node: JsonSchema): JsonSchema {
  const type = node.type;
  const out: JsonSchema = { ...node };
  if (Array.isArray(type)) {
    if (!type.includes('null')) out.type = [...type, 'null'];
  } else if (typeof type === 'string' && type !== 'null') {
    out.type = [type, 'null'];
  }
  if (Array.isArray(node.enum) && !node.enum.includes(null)) {
    out.enum = [...node.enum, null];
  }
  return out;
}

/**
 * Model calls with a JSON schema for ai-ingest (plan ia-cargas §3.2 step 7):
 *
 * - `run(appKey, {}, messages, { responseSchema })`: the app keeps its prompt,
 *   gate, quota, logging and cost; the provider only gets structured output
 *   when its config opts in (`settings.supports_json_schema`).
 * - The answer is validated with ajv. If it fails, ONE repair call carries the
 *   previous answer and the ajv errors.
 * - `finish_reason === 'length'` never reaches the parser: a batch is halved
 *   and retried (depth ≤ 3); a single call reports `truncated`.
 * - Batches run with limited concurrency (3) and report real progress.
 */
@Injectable()
export class AiExtractionService {
  private readonly logger = new Logger(AiExtractionService.name);
  /**
   * `coerceTypes`: a model that writes a document number as 900123456 (number)
   * instead of "900123456" is still valid, as the old hand-written parser
   * accepted; nothing else is coerced (no scalar → array).
   */
  private readonly ajv = new Ajv({
    allErrors: true,
    strict: false,
    coerceTypes: true,
  });
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(private readonly aiEngine: AIEngineService) {}

  /** One call (+ at most one repair). Throws {@link AiExtractionError}. */
  async extract<T>(options: ExtractOptions): Promise<T> {
    const validate = this.validator(options.schema);
    const responseSchema = {
      name: options.schema.name,
      schema: toStrictJsonSchema(options.schema.schema),
    };

    const quotaKey = options.quotaKey ?? newIngestQuotaKey();
    const attempt = options.attempt ?? 1;
    const first = await this.call<T>(
      options.appKey,
      options.messages,
      responseSchema,
      quotaKey,
      options.variables,
      validate,
      attempt,
    );
    const firstCheck =
      first.check ?? this.check<T>(first.content ?? '', validate);
    if (firstCheck.ok) return firstCheck.data;

    this.logger.warn(
      `[AiExtraction] ${options.appKey}/${options.schema.name} invalid output, repairing: ${firstCheck.errors.slice(0, 3).join('; ')}`,
    );
    const repairMessages: AIMessage[] = [
      ...options.messages,
      {
        role: 'assistant',
        content: (first.content ?? '').slice(0, MAX_ECHO_CHARS),
      },
      {
        role: 'user',
        content: [
          'Your previous answer is not valid for the required JSON schema.',
          'Errors:',
          ...firstCheck.errors.slice(0, MAX_ERRORS_SHOWN).map((e) => `- ${e}`),
          'Return ONLY the corrected JSON object, with no markdown and no explanations.',
        ].join('\n'),
      },
    ];
    const second = await this.call<T>(
      options.appKey,
      repairMessages,
      responseSchema,
      quotaKey,
      options.variables,
      validate,
      attempt + 1,
    );
    const secondCheck =
      second.check ?? this.check<T>(second.content ?? '', validate);
    if (secondCheck.ok) return secondCheck.data;

    throw new AiExtractionError(
      'invalid',
      `Invalid AI output after repair: ${secondCheck.errors.slice(0, 3).join('; ')}`,
      second.response,
    );
  }

  /**
   * Items in batches. A truncated batch is halved (up to `maxSplitDepth`
   * times); a batch still truncated or invalid is returned in `failed` so the
   * caller reports its items instead of losing them. A provider failure
   * aborts the run (the job retries it as a whole).
   */
  async extractBatches<TItem, TOut>(
    options: ExtractBatchesOptions<TItem>,
  ): Promise<ExtractBatchesResult<TItem, TOut>> {
    const total = options.items.length;
    const maxDepth = options.maxSplitDepth ?? 3;
    const quotaKey = options.quotaKey ?? newIngestQuotaKey();
    const results: ExtractedBatch<TItem, TOut>[] = [];
    const failed: FailedBatch<TItem>[] = [];
    let done = 0;

    const advance = async (count: number) => {
      done += count;
      try {
        await options.onProgress?.(Math.min(done, total), total);
      } catch {
        // Progress is best effort; it never breaks the extraction.
      }
    };

    const runBatch = async (items: TItem[], depth: number): Promise<void> => {
      // Heartbeat: a long chain of splits still reports it is alive (the job
      // monitor counts "stalled" from the last progress report).
      await advance(0);
      try {
        const data = await this.extract<TOut>({
          appKey: options.appKey,
          schema: options.schema,
          messages: options.buildMessages(items),
          quotaKey,
          variables: options.variables,
          attempt: 1 + depth,
        });
        results.push({ items, data });
        await advance(items.length);
      } catch (error) {
        if (
          !(error instanceof AiExtractionError) ||
          error.failure === 'ai_failed'
        ) {
          throw error;
        }
        if (
          error.failure === 'truncated' &&
          items.length > 1 &&
          depth < maxDepth
        ) {
          const half = Math.ceil(items.length / 2);
          this.logger.warn(
            `[AiExtraction] ${options.appKey} batch of ${items.length} truncated; splitting (depth ${depth + 1})`,
          );
          await runBatch(items.slice(0, half), depth + 1);
          await runBatch(items.slice(half), depth + 1);
          return;
        }
        failed.push({ items, failure: error.failure, message: error.message });
        await advance(items.length);
      }
    };

    await mapWithConcurrency(
      chunk(options.items, options.batchSize),
      options.concurrency ?? 3,
      (batch) => runBatch(batch, 0),
    );
    return { results, failed };
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * One provider call. The log row gets `attempt` and, through
   * `logContext.validate`, the same verdict {@link check} gives, so
   * `validation_error` says why the answer was rejected. The verdict is
   * reused here (one parse per answer); the call itself is unchanged.
   */
  private async call<T>(
    appKey: string,
    messages: AIMessage[],
    responseSchema: { name: string; schema: JsonSchema },
    quotaKey: string,
    variables: Record<string, string> | undefined,
    validate: ValidateFunction,
    attempt: number,
  ): Promise<{
    content: string | undefined;
    response: AIResponse;
    check?: CheckResult<T>;
  }> {
    // Holder object: a `let` set inside the callback would stay narrowed to
    // `undefined` for the compiler after the await.
    const seen: { verdict?: { content: string; check: CheckResult<T> } } = {};
    const response = await this.aiEngine.run(
      appKey,
      variables ?? {},
      messages,
      {
        responseSchema,
        quotaKey,
        logContext: {
          attempt,
          validate: (content) => {
            const check = this.check<T>(content, validate);
            seen.verdict = { content, check };
            return check.ok ? null : check.logError;
          },
        },
      },
    );
    if (!response.success) {
      throw new AiExtractionError(
        'ai_failed',
        response.error ?? 'AI request failed',
        response,
      );
    }
    if (response.finish_reason === 'length') {
      throw new AiExtractionError('truncated', 'AI output truncated', response);
    }
    const content = response.content ?? '';
    return {
      content: response.content,
      response,
      // Reuse only a verdict on exactly this text; otherwise check again.
      check:
        seen.verdict && seen.verdict.content === content
          ? seen.verdict.check
          : undefined,
    };
  }

  private check<T>(
    content: string,
    validate: ValidateFunction,
  ): CheckResult<T> {
    let parsed: unknown;
    try {
      parsed = parseAiJson(content);
    } catch (error) {
      return {
        ok: false,
        errors: [`The answer is not valid JSON (${(error as Error).message}).`],
        logError: NOT_JSON_LOG_ERROR,
      };
    }
    // The provider gets the strict schema (optional = nullable) but ajv checks
    // the lenient one: a `null` optional means "absent", so drop it first.
    parsed = dropNullKeys(parsed);
    if (validate(parsed)) return { ok: true, data: parsed as T };
    const errors = this.describe(validate.errors);
    return {
      ok: false,
      errors,
      // Paths and ajv messages only (schema words, never the model's values).
      logError: `schema: ${errors.slice(0, MAX_ERRORS_SHOWN).join('; ')}`,
    };
  }

  private describe(errors: ErrorObject[] | null | undefined): string[] {
    return (errors ?? []).map(
      (e) => `${e.instancePath || '(root)'} ${e.message ?? 'is invalid'}`,
    );
  }

  /** Cached by name AND content: two profiles may reuse a name with other fields. */
  private validator(schema: ExtractionSchema): ValidateFunction {
    const key = `${schema.name}:${JSON.stringify(schema.schema)}`;
    let validate = this.validators.get(key);
    if (!validate) {
      validate = this.ajv.compile(schema.schema);
      this.validators.set(key, validate);
    }
    return validate;
  }
}
