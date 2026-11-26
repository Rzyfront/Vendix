import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AgentTraceService } from './observability/agent-trace.service';
import { checkAiBaseUrl, resolveConfigApiKey } from './ai-config-security';

/**
 * Vex tie-breaker classifier (OpenRouter: Decisions API or chat completions).
 *
 * The turn state decides; this classifier only gives an opinion when the
 * answer lives in free text (a «sí/no», a promise vs. a description, a missing
 * tool). It NEVER replaces Vex's text and NEVER throws: every failure path —
 * no `vex_classifier` row, inactive row, missing key, timeout, 4xx/5xx,
 * invalid schema, refusal, turn cap — resolves to `unavailable`, and callers
 * keep today's behavior.
 *
 * Configuration lives in the engine, not in code:
 * - `ai_engine_applications` row `key = 'vex_classifier'`: `is_active` is the
 *   switch, `rate_limit.max_calls_per_turn` the turn cap counted in HTTP
 *   POSTs (every retry, repair turn and `response_format` resend spends one),
 *   `retry_config` `{ timeout_ms, total_timeout_ms, max_retries }` where
 *   `timeout_ms` bounds one POST and `total_timeout_ms` the whole logical call
 *   (retries and repair included), `metadata.criteria_version` and optional
 *   `metadata.min_confidence`.
 * - `metadata.adapter`: `auto` (default) | `decisions` | `chat`. `auto` uses
 *   the Decisions API only for models listed in `DECISIONS_MODEL_PREFIXES`
 *   and chat completions for any other OpenRouter model. A forced
 *   `decisions` on a model outside that list is `adapter_unsupported`.
 * - `metadata.temperature` / `max_tokens` / `reasoning_effort`: sent only by
 *   the chat adapter and only when present and valid; never invented.
 * - `metadata.json_mode` (default true): send `response_format: json_object`
 *   in chat. The message always demands strict JSON as well.
 * - Its `config` (`ai_engine_configs`): `model_id` (the only source of the
 *   model: none is written in code; empty → `no_model`), optional `base_url`
 *   and `api_key_ref`. `api_key_ref` means what it means everywhere in the
 *   engine: the literal key (masked by the panel), falling back to
 *   `AI_<PROVIDER>_API_KEY` (`resolveConfigApiKey`). `base_url` must be https
 *   on a host of `VEX_CLASSIFIER_ALLOWED_HOSTS` (OpenRouter: the adapter
 *   paths are OpenRouter's); anything else is `host_not_allowed`, never a
 *   silent fallback. Redirects are never followed.
 */

export const VEX_CLASSIFIER_APP_KEY = 'vex_classifier';
export const OPENROUTER_ORIGIN = 'https://openrouter.ai';
export const DECISIONS_PATH = '/api/alpha/decisions';
export const CHAT_COMPLETIONS_PATH = '/api/v1/chat/completions';
export const DECISIONS_ENDPOINT = `${OPENROUTER_ORIGIN}${DECISIONS_PATH}`;
export const CHAT_COMPLETIONS_ENDPOINT = `${OPENROUTER_ORIGIN}${CHAT_COMPLETIONS_PATH}`;

/**
 * Catalog `model_id` prefixes that speak the OpenRouter Decisions API
 * (`/api/alpha/decisions`). With `adapter: 'auto'` only these use it; every
 * other model goes through chat completions. To add a model family, append
 * its prefix here (and to the table in REPORTE.md).
 */
export const DECISIONS_MODEL_PREFIXES: readonly string[] = ['typesafe/'];

/**
 * Hosts the classifier may send its key to. Its paths are OpenRouter's, so
 * only OpenRouter; widening this is a code change on purpose.
 */
export const VEX_CLASSIFIER_ALLOWED_HOSTS: readonly string[] = ['openrouter.ai'];

export type ClassifierAdapterSetting = 'auto' | 'decisions' | 'chat';
export type ClassifierAdapter = 'decisions' | 'chat';

export function supportsDecisions(modelId: string): boolean {
  return DECISIONS_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

const DEFAULT_TIMEOUT_MS = 800;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
/** Whole logical call (retries + repair + resend), not one POST. */
const DEFAULT_TOTAL_TIMEOUT_MS = 1_200;
/** HTTP POSTs per turn (request id), across every logical call. */
const DEFAULT_MAX_CALLS_PER_TURN = 3;
const MAX_JSON_MODE_REJECTIONS = 100;
const DEFAULT_CRITERIA_VERSION = 'v1';
const DEFAULT_MIN_CONFIDENCE = 0;
const SETTINGS_TTL_MS = 30_000;
const TURN_COUNTER_TTL_MS = 10 * 60_000;
const MAX_TRACKED_TURNS = 1_000;
const MAX_STATE_CHARS = 4_000;
const MAX_RAW_ANSWER_CHARS = 500;
/** Id of the single question in both adapters (`answers.verdict` / `{"verdict": …}`). */
const QUESTION_ID = 'verdict';
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

export type ConfirmationReading = 'accept' | 'reject' | 'ambiguous';
export type WritePromiseReading = 'promise' | 'description' | 'question';
export type MissingToolReading = 'exists' | 'missing' | 'unclear';

export type ClassifierQuestion =
  | 'confirmation'
  | 'write_promise'
  | 'missing_tool';

export type ClassifierDegradation =
  | 'not_configured'
  | 'inactive'
  | 'no_api_key'
  | 'host_not_allowed'
  | 'config_error'
  | 'no_model'
  | 'adapter_unsupported'
  | 'turn_cap'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'invalid_response'
  | 'refusal'
  | 'low_confidence'
  | 'empty_input';

export type ClassifierVerdict<T extends string> =
  | {
      value: T;
      confidence: number | null;
      criteria_version: string;
      latency_ms: number;
    }
  | {
      value: 'unavailable';
      reason: ClassifierDegradation;
      criteria_version?: string;
      latency_ms: number;
    };

/** Minimal HTTP port: injectable so specs never touch the network. */
export interface ClassifierHttpResponse {
  status: number;
  json(): Promise<unknown>;
}
export type ClassifierHttpClient = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  },
) => Promise<ClassifierHttpResponse>;
export const VEX_CLASSIFIER_HTTP = Symbol('VEX_CLASSIFIER_HTTP');

interface ChatParams {
  temperature?: number;
  max_tokens?: number;
  reasoning?: { effort: string };
}

interface ClassifierSettings {
  adapter: ClassifierAdapter;
  endpoint: string;
  model: string;
  chatParams: ChatParams;
  jsonMode: boolean;
  apiKey: string;
  timeoutMs: number;
  totalTimeoutMs: number;
  maxRetries: 0 | 1;
  maxCallsPerTurn: number;
  criteriaVersion: string;
  minConfidence: number;
}

type Resolved =
  | { ok: true; settings: ClassifierSettings }
  | {
      ok: false;
      reason: ClassifierDegradation;
      adapter?: ClassifierAdapter;
      model?: string;
    };

/** Adapter outcome before the shared confidence gate. */
type AdapterOutcome =
  | { ok: true; value: string; confidence: number | null }
  | { ok: false; reason: ClassifierDegradation };

/** What the span records besides the verdict: never user content. */
interface CallMeta {
  adapter?: ClassifierAdapter;
  model?: string;
}

interface ChoiceQuestion<T extends string> {
  question: ClassifierQuestion;
  state: string;
  instructions: string;
  criteria: Record<T, string>;
}

/** Budget of one logical call: absolute deadline and the turn's POST counter key. */
interface CallBudget {
  deadline: number;
  turnKey: string;
}

type AttemptResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: ClassifierDegradation; retryable: boolean; status?: number };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `null`/`undefined`/blank are "not set" (default), never 0. */
function numberOrNaN(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'string' && !value.trim()) return NaN;
  return Number(value);
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_STATE_CHARS
    ? clean.slice(0, MAX_STATE_CHARS)
    : clean;
}

type ChatParse =
  | { kind: 'valid'; value: string }
  | { kind: 'refusal' }
  | { kind: 'invalid'; raw: string };

/**
 * Validates a chat completion against the question schema: exactly one key
 * (`verdict`) whose value is one of the allowed criteria. Tolerates a
 * ```json fence around the object; nothing else.
 */
function parseChatAnswer(body: unknown, allowed: string[]): ChatParse {
  const choices = record(body)?.choices;
  const first = Array.isArray(choices) ? record(choices[0]) : null;
  const message = record(first?.message);
  if (
    (typeof message?.refusal === 'string' && message.refusal.trim()) ||
    first?.finish_reason === 'content_filter'
  )
    return { kind: 'refusal' };
  const content = typeof message?.content === 'string' ? message.content : '';
  const raw = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', raw: content };
  }
  const obj = record(parsed);
  const keys = obj ? Object.keys(obj) : [];
  const value = obj?.[QUESTION_ID];
  if (
    keys.length !== 1 ||
    keys[0] !== QUESTION_ID ||
    typeof value !== 'string' ||
    !allowed.includes(value)
  )
    return { kind: 'invalid', raw: content };
  return { kind: 'valid', value };
}

/** Only the chat params present and valid in metadata; never defaults. */
function chatParamsFrom(meta: Record<string, unknown>): ChatParams {
  const params: ChatParams = {};
  const temperature = meta.temperature;
  if (
    typeof temperature === 'number' &&
    Number.isFinite(temperature) &&
    temperature >= 0 &&
    temperature <= 2
  )
    params.temperature = temperature;
  const maxTokens = meta.max_tokens;
  if (
    typeof maxTokens === 'number' &&
    Number.isInteger(maxTokens) &&
    maxTokens > 0 &&
    maxTokens <= 32_000
  )
    params.max_tokens = maxTokens;
  const effort = meta.reasoning_effort;
  if (typeof effort === 'string' && REASONING_EFFORTS.has(effort))
    params.reasoning = { effort };
  return params;
}

@Injectable()
export class VexClassifierService {
  private readonly logger = new Logger(VexClassifierService.name);
  private cached: { value: Resolved; expiresAt: number } | null = null;
  private readonly turnCalls = new Map<string, { count: number; at: number }>();
  /** Models that answered 400 to `response_format`: resend never paid twice. */
  private readonly jsonModeRejected = new Set<string>();
  private readonly http: ClassifierHttpClient;

  constructor(
    private readonly prisma: GlobalPrismaService,
    @Optional() private readonly trace?: AgentTraceService,
    @Optional() @Inject(VEX_CLASSIFIER_HTTP) http?: ClassifierHttpClient,
  ) {
    this.http =
      http ??
      ((url, init) =>
        fetch(url, init).then((res) => ({
          status: res.status,
          json: () => res.json() as Promise<unknown>,
        })));
  }

  /** Drop the cached application so the next call re-reads the row. */
  invalidate(): void {
    this.cached = null;
  }

  /**
   * Reads the person's reply to a pending card. Opinion only: the card is
   * still the only thing that authorizes a write.
   */
  readConfirmation(
    reply: string,
    pendingQuestion: string,
  ): Promise<ClassifierVerdict<ConfirmationReading>> {
    return this.ask<ConfirmationReading>({
      question: 'confirmation',
      state: `Pregunta pendiente de Vex: ${clip(pendingQuestion)}\nRespuesta de la persona: ${clip(reply)}`,
      instructions:
        'Vex le hizo a la persona la pregunta pendiente y quedó una tarjeta esperando aprobación. Clasifica solo lo que la persona respondió a esa pregunta.',
      criteria: {
        accept:
          'Acepta sin condiciones lo que se le propuso (sí, dale, hágale, de una, listo, ok, apruebo).',
        reject:
          'Rechaza o cancela lo propuesto (no, mejor no, cancela, déjalo así, espera, todavía no).',
        ambiguous:
          'No responde la pregunta, pone condiciones, pide cambios, pregunta otra cosa o no se puede saber.',
      },
    });
  }

  /**
   * Prepared for the next cycle (not wired yet): whether a text of Vex
   * promises an action, describes something or asks.
   */
  isWritePromise(text: string): Promise<ClassifierVerdict<WritePromiseReading>> {
    return this.ask<WritePromiseReading>({
      question: 'write_promise',
      state: `Texto de Vex: ${clip(text)}`,
      instructions:
        'Clasifica el texto de un asistente de una tienda según lo que le dice a la persona.',
      criteria: {
        promise:
          'Promete hacer, aplicar, crear, cambiar o encargarse de algo en el sistema (voy a, ya lo hago, lo aplico, me encargo).',
        description:
          'Describe datos, resultados o cómo se hace algo, sin comprometerse a ejecutar un cambio.',
        question:
          'Pregunta a la persona o le pide un dato o una decisión antes de seguir.',
      },
    });
  }

  /**
   * Whether the person's request needs a capability the catalog lacks. The
   * deterministic catalog check always runs first and wins.
   */
  needsMissingTool(
    request: string,
    catalogSummary: string,
  ): Promise<ClassifierVerdict<MissingToolReading>> {
    return this.ask<MissingToolReading>({
      question: 'missing_tool',
      state: `Lo que pide la persona: ${clip(request)}\nResumen del catálogo de Vendix: ${clip(catalogSummary)}`,
      instructions:
        'Decide si lo que pide la persona en una tienda Vendix ya se puede hacer con alguna capacidad del catálogo resumido, o si de verdad falta.',
      criteria: {
        exists:
          'Alguna capacidad del catálogo ya lo hace, aunque sea en parte o con otro nombre.',
        missing:
          'Ninguna capacidad del catálogo lo hace y la petición es concreta: es una capacidad que falta.',
        unclear:
          'La petición es vaga, mezcla varias cosas o no alcanza para decidir.',
      },
    });
  }

  private async ask<T extends string>(
    q: ChoiceQuestion<T>,
  ): Promise<ClassifierVerdict<T>> {
    const started = Date.now();
    const span = this.safeStartSpan(q.question);
    const meta: CallMeta = {};
    let verdict: ClassifierVerdict<T>;
    try {
      verdict = await this.classify(q, started, meta);
    } catch {
      // Defensive: classify() already maps every failure; nothing escapes.
      verdict = {
        value: 'unavailable',
        reason: 'config_error',
        latency_ms: Date.now() - started,
      };
    }
    this.observe(q.question, verdict, meta, span);
    return verdict;
  }

  private async classify<T extends string>(
    q: ChoiceQuestion<T>,
    started: number,
    meta: CallMeta,
  ): Promise<ClassifierVerdict<T>> {
    const unavailable = (
      reason: ClassifierDegradation,
      criteria_version?: string,
    ): ClassifierVerdict<T> => ({
      value: 'unavailable',
      reason,
      criteria_version,
      latency_ms: Date.now() - started,
    });

    const resolved = await this.resolve();
    if (!resolved.ok) {
      meta.adapter = resolved.adapter;
      meta.model = resolved.model;
      return unavailable(resolved.reason);
    }
    const s = resolved.settings;
    meta.adapter = s.adapter;
    meta.model = s.model;
    if (!q.state.trim()) return unavailable('empty_input', s.criteriaVersion);

    // Without a request id the call is its own turn: still bounded by the
    // POST cap and the total deadline.
    const budget: CallBudget = {
      deadline: started + s.totalTimeoutMs,
      turnKey: RequestContextService.getRequestId() ?? randomUUID(),
    };
    const outcome =
      s.adapter === 'decisions'
        ? await this.viaDecisions(q, s, budget)
        : await this.viaChat(q, s, budget);
    if (!outcome.ok) return unavailable(outcome.reason, s.criteriaVersion);
    if (
      s.minConfidence > 0 &&
      (outcome.confidence === null || outcome.confidence < s.minConfidence)
    )
      return unavailable('low_confidence', s.criteriaVersion);
    return {
      value: outcome.value as T,
      confidence: outcome.confidence,
      criteria_version: s.criteriaVersion,
      latency_ms: Date.now() - started,
    };
  }

  /** Transport call with the single retry for 429/5xx/timeout/network. */
  private async send(
    s: ClassifierSettings,
    body: string,
    budget: CallBudget,
  ): Promise<AttemptResult> {
    let attempt = await this.post(s, body, budget);
    if (!attempt.ok && attempt.retryable && s.maxRetries > 0)
      attempt = await this.post(s, body, budget);
    return attempt;
  }

  /** Decisions API: typed `choice` question, answer keyed by question id. */
  private async viaDecisions<T extends string>(
    q: ChoiceQuestion<T>,
    s: ClassifierSettings,
    budget: CallBudget,
  ): Promise<AdapterOutcome> {
    const body = JSON.stringify({
      model: s.model,
      state: q.state,
      questions: {
        [QUESTION_ID]: {
          type: 'choice',
          instructions: `${q.instructions} (criterios ${s.criteriaVersion})`,
          criteria: q.criteria,
        },
      },
    });
    const attempt = await this.send(s, body, budget);
    if (!attempt.ok) return { ok: false, reason: attempt.reason };

    const answer = record(record(record(attempt.body)?.answers)?.[QUESTION_ID]);
    if (!answer) return { ok: false, reason: 'invalid_response' };
    if (answer.type === 'refusal') return { ok: false, reason: 'refusal' };
    const choice = answer.choice;
    if (
      answer.type !== 'choice' ||
      typeof choice !== 'string' ||
      !Object.prototype.hasOwnProperty.call(q.criteria, choice)
    )
      return { ok: false, reason: 'invalid_response' };
    const confidence =
      typeof answer.confidence === 'number' &&
      Number.isFinite(answer.confidence)
        ? answer.confidence
        : null;
    return { ok: true, value: choice, confidence };
  }

  /**
   * Chat completions, for any OpenRouter model: same state and criteria as a
   * message demanding strict JSON `{ "verdict": "<value>" }`, validated
   * against the same allowed values. One repair turn if it does not
   * validate; a second invalid answer is `invalid_response`.
   */
  private async viaChat<T extends string>(
    q: ChoiceQuestion<T>,
    s: ClassifierSettings,
    budget: CallBudget,
  ): Promise<AdapterOutcome> {
    const allowed = Object.keys(q.criteria);
    const shape = `{"${QUESTION_ID}": "<${allowed.join(' | ')}>"}`;
    const criteria = allowed
      .map((value) => `- "${value}": ${q.criteria[value as T]}`)
      .join('\n');
    const messages: Array<{ role: string; content: string }> = [
      {
        role: 'system',
        content: [
          `${q.instructions} (criterios ${s.criteriaVersion})`,
          `Valores permitidos para "${QUESTION_ID}":\n${criteria}`,
          `Responde SOLO con un objeto JSON válido, sin texto adicional ni bloques de código, con exactamente esta forma: ${shape}`,
        ].join('\n\n'),
      },
      { role: 'user', content: q.state },
    ];

    for (let turn = 0; turn < 2; turn++) {
      const attempt = await this.sendChat(s, messages, budget);
      if (!attempt.ok) return { ok: false, reason: attempt.reason };
      const parsed = parseChatAnswer(attempt.body, allowed);
      if (parsed.kind === 'refusal') return { ok: false, reason: 'refusal' };
      if (parsed.kind === 'valid')
        return { ok: true, value: parsed.value, confidence: null };
      if (turn === 0) {
        messages.push(
          { role: 'assistant', content: parsed.raw.slice(0, MAX_RAW_ANSWER_CHARS) },
          {
            role: 'user',
            content: `Tu respuesta no es válida. Responde SOLO con JSON con exactamente esta forma: ${shape}`,
          },
        );
      }
    }
    return { ok: false, reason: 'invalid_response' };
  }

  /**
   * Sends `response_format: json_object` when `json_mode` is on; if the
   * provider rejects the request with 400, retries once without it (the
   * message already demands JSON) and remembers the model, so later calls
   * skip the doomed first POST.
   */
  private async sendChat(
    s: ClassifierSettings,
    messages: Array<{ role: string; content: string }>,
    budget: CallBudget,
  ): Promise<AttemptResult> {
    const payload = (json: boolean) =>
      JSON.stringify({
        model: s.model,
        messages,
        ...s.chatParams,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      });
    const json = s.jsonMode && !this.jsonModeRejected.has(s.model);
    const attempt = await this.send(s, payload(json), budget);
    if (!attempt.ok && json && attempt.status === 400) {
      if (this.jsonModeRejected.size >= MAX_JSON_MODE_REJECTIONS)
        this.jsonModeRejected.clear();
      this.jsonModeRejected.add(s.model);
      return this.send(s, payload(false), budget);
    }
    return attempt;
  }

  /**
   * One HTTP POST. Spends one slot of the turn cap before sending and never
   * outlives the logical call's deadline: its timer is the smaller of
   * `timeout_ms` and the time left.
   */
  private async post(
    s: ClassifierSettings,
    body: string,
    budget: CallBudget,
  ): Promise<AttemptResult> {
    const remaining = budget.deadline - Date.now();
    if (remaining <= 0)
      return { ok: false, reason: 'timeout', retryable: false };
    if (!this.takeTurnSlot(budget.turnKey, s.maxCallsPerTurn))
      return { ok: false, reason: 'turn_cap', retryable: false };
    const controller = new AbortController();
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<AttemptResult>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve({ ok: false, reason: 'timeout', retryable: true });
      }, Math.min(s.timeoutMs, remaining));
    });
    const call = (async (): Promise<AttemptResult> => {
      let res: ClassifierHttpResponse;
      try {
        res = await this.http(s.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${s.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
          redirect: 'error',
        });
      } catch {
        return timedOut
          ? { ok: false, reason: 'timeout', retryable: true }
          : { ok: false, reason: 'network_error', retryable: true };
      }
      if (res.status < 200 || res.status >= 300) {
        return {
          ok: false,
          reason: 'http_error',
          status: res.status,
          retryable: res.status === 429 || res.status >= 500,
        };
      }
      try {
        return { ok: true, body: await res.json() };
      } catch {
        return timedOut
          ? { ok: false, reason: 'timeout', retryable: true }
          : { ok: false, reason: 'invalid_response', retryable: false };
      }
    })();
    try {
      return await Promise.race([call, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async resolve(): Promise<Resolved> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.value;
    let value: Resolved;
    try {
      value = await this.load();
    } catch {
      value = { ok: false, reason: 'config_error' };
    }
    this.cached = { value, expiresAt: now + SETTINGS_TTL_MS };
    return value;
  }

  private async load(): Promise<Resolved> {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { key: VEX_CLASSIFIER_APP_KEY },
      include: { config: true },
    });
    if (!app) return { ok: false, reason: 'not_configured' };
    if (!app.is_active) return { ok: false, reason: 'inactive' };
    const config = app.config;
    if (!config) return { ok: false, reason: 'not_configured' };
    if (!config.is_active) return { ok: false, reason: 'inactive' };
    const model = config.model_id?.trim() ?? '';
    if (!model) return { ok: false, reason: 'no_model' };

    const meta = record(app.metadata) ?? {};
    const adapterSetting = meta.adapter ?? 'auto';
    let adapter: ClassifierAdapter;
    if (adapterSetting === 'auto')
      adapter = supportsDecisions(model) ? 'decisions' : 'chat';
    else if (adapterSetting === 'chat') adapter = 'chat';
    else if (adapterSetting === 'decisions') {
      // Forced Decisions on a model that does not speak it: fail closed,
      // never guess a fallback the admin did not ask for.
      if (!supportsDecisions(model))
        return { ok: false, reason: 'adapter_unsupported', adapter: 'decisions', model };
      adapter = 'decisions';
    } else return { ok: false, reason: 'config_error', model };

    // Same semantics as the engine: literal key, then AI_<PROVIDER>_API_KEY.
    // Never an arbitrary environment variable named by the row.
    const apiKey = resolveConfigApiKey(config, (name) => process.env[name]).trim();
    if (!apiKey) return { ok: false, reason: 'no_api_key', adapter, model };

    let origin = OPENROUTER_ORIGIN;
    const baseUrl = config.base_url?.trim();
    if (baseUrl) {
      const check = checkAiBaseUrl(baseUrl, VEX_CLASSIFIER_ALLOWED_HOSTS);
      if (!check.ok)
        return { ok: false, reason: 'host_not_allowed', adapter, model };
      origin = check.url.origin;
    }

    const retry = record(app.retry_config) ?? {};
    const rate = record(app.rate_limit) ?? {};
    const timeoutRaw = numberOrNaN(retry.timeout_ms);
    const timeoutMs = Number.isFinite(timeoutRaw)
      ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutRaw))
      : DEFAULT_TIMEOUT_MS;
    const totalRaw = numberOrNaN(retry.total_timeout_ms);
    const totalTimeoutMs = Number.isFinite(totalRaw)
      ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, totalRaw))
      : DEFAULT_TOTAL_TIMEOUT_MS;
    const capRaw = numberOrNaN(rate.max_calls_per_turn);
    const maxCallsPerTurn =
      Number.isInteger(capRaw) && capRaw >= 0
        ? capRaw
        : DEFAULT_MAX_CALLS_PER_TURN;
    const minRaw = numberOrNaN(meta.min_confidence);
    const minConfidence =
      Number.isFinite(minRaw) && minRaw >= 0 && minRaw <= 1
        ? minRaw
        : DEFAULT_MIN_CONFIDENCE;
    const version =
      typeof meta.criteria_version === 'string' &&
      /^[\w.-]{1,20}$/.test(meta.criteria_version)
        ? meta.criteria_version
        : DEFAULT_CRITERIA_VERSION;
    return {
      ok: true,
      settings: {
        adapter,
        endpoint: `${origin}${adapter === 'decisions' ? DECISIONS_PATH : CHAT_COMPLETIONS_PATH}`,
        model,
        // Decisions ignores sampling params: it has its own typed contract.
        chatParams: adapter === 'chat' ? chatParamsFrom(meta) : {},
        jsonMode: meta.json_mode !== false,
        apiKey,
        timeoutMs,
        totalTimeoutMs,
        maxRetries: numberOrNaN(retry.max_retries) === 0 ? 0 : 1,
        maxCallsPerTurn,
        criteriaVersion: version,
        minConfidence,
      },
    };
  }

  /**
   * One turn = one request (`X-Request-Id`); one slot = one HTTP POST. When
   * too many turns are tracked, expired ones go first and then the oldest,
   * never every live counter at once.
   */
  private takeTurnSlot(key: string, max: number): boolean {
    const now = Date.now();
    if (this.turnCalls.size > MAX_TRACKED_TURNS) {
      for (const [tracked, entry] of this.turnCalls)
        if (now - entry.at > TURN_COUNTER_TTL_MS) this.turnCalls.delete(tracked);
      for (const tracked of this.turnCalls.keys()) {
        if (this.turnCalls.size <= MAX_TRACKED_TURNS) break;
        this.turnCalls.delete(tracked);
      }
    }
    const entry = this.turnCalls.get(key) ?? { count: 0, at: now };
    if (entry.count >= max) return false;
    entry.count += 1;
    entry.at = now;
    this.turnCalls.set(key, entry);
    return true;
  }

  private safeStartSpan(question: ClassifierQuestion) {
    try {
      return this.trace?.startSpan('verifier', {
        classifier_question: question,
      });
    } catch {
      return undefined;
    }
  }

  /** Latency, result and degradation reason only: no text, no identities. */
  private observe(
    question: ClassifierQuestion,
    verdict: ClassifierVerdict<string>,
    meta: CallMeta,
    span: ReturnType<VexClassifierService['safeStartSpan']>,
  ): void {
    const degraded = verdict.value === 'unavailable';
    const reason = 'reason' in verdict ? verdict.reason : undefined;
    try {
      this.trace?.endSpan(span, {
        status: degraded ? 'error' : 'ok',
        error_code: reason ? `VEX_CLASSIFIER_${reason.toUpperCase()}` : undefined,
        duration_ms: verdict.latency_ms,
        attributes: {
          classifier_question: question,
          classifier_verdict: verdict.value,
          ...(meta.adapter ? { classifier_adapter: meta.adapter } : {}),
          ...(meta.model ? { classifier_model: meta.model } : {}),
          ...(reason ? { classifier_degradation: reason } : {}),
        },
      });
    } catch {
      // Telemetry never affects the turn.
    }
    this.logger.debug(
      `vex_classifier question=${question} adapter=${meta.adapter ?? '-'} model=${meta.model ?? '-'} verdict=${verdict.value}${reason ? ` reason=${reason}` : ''} latency_ms=${verdict.latency_ms}`,
    );
  }
}
