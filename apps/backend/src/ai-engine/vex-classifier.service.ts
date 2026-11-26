import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AgentTraceService } from './observability/agent-trace.service';

/**
 * Vex tie-breaker classifier (OpenRouter Decisions API).
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
 *   switch, `rate_limit.max_calls_per_turn` the turn cap, `retry_config`
 *   `{ timeout_ms, max_retries }`, `metadata.criteria_version` and optional
 *   `metadata.min_confidence`.
 * - Its `config` (`ai_engine_configs`): `model_id`, optional `base_url` (the
 *   full Decisions endpoint) and `api_key_ref`, the NAME of the environment
 *   variable holding the key. The key itself is never stored in the table.
 */

export const VEX_CLASSIFIER_APP_KEY = 'vex_classifier';
export const DECISIONS_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

const DEFAULT_TIMEOUT_MS = 800;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CALLS_PER_TURN = 3;
const DEFAULT_CRITERIA_VERSION = 'v1';
const DEFAULT_MIN_CONFIDENCE = 0;
const SETTINGS_TTL_MS = 30_000;
const TURN_COUNTER_TTL_MS = 10 * 60_000;
const MAX_TRACKED_TURNS = 1_000;
const MAX_STATE_CHARS = 4_000;
/** Environment variable names only: a literal key is never accepted. */
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,99}$/;

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
  | 'config_error'
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
  },
) => Promise<ClassifierHttpResponse>;
export const VEX_CLASSIFIER_HTTP = Symbol('VEX_CLASSIFIER_HTTP');

interface ClassifierSettings {
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: 0 | 1;
  maxCallsPerTurn: number;
  criteriaVersion: string;
  minConfidence: number;
}

type Resolved =
  | { ok: true; settings: ClassifierSettings }
  | { ok: false; reason: ClassifierDegradation };

interface ChoiceQuestion<T extends string> {
  question: ClassifierQuestion;
  state: string;
  instructions: string;
  criteria: Record<T, string>;
}

type AttemptResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: ClassifierDegradation; retryable: boolean; status?: number };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_STATE_CHARS
    ? clean.slice(0, MAX_STATE_CHARS)
    : clean;
}

@Injectable()
export class VexClassifierService {
  private readonly logger = new Logger(VexClassifierService.name);
  private cached: { value: Resolved; expiresAt: number } | null = null;
  private readonly turnCalls = new Map<string, { count: number; at: number }>();
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
    let verdict: ClassifierVerdict<T>;
    try {
      verdict = await this.classify(q, started);
    } catch {
      // Defensive: classify() already maps every failure; nothing escapes.
      verdict = {
        value: 'unavailable',
        reason: 'config_error',
        latency_ms: Date.now() - started,
      };
    }
    this.observe(q.question, verdict, span);
    return verdict;
  }

  private async classify<T extends string>(
    q: ChoiceQuestion<T>,
    started: number,
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
    if (!resolved.ok) return unavailable(resolved.reason);
    const s = resolved.settings;
    if (!q.state.trim()) return unavailable('empty_input', s.criteriaVersion);
    if (!this.takeTurnSlot(s.maxCallsPerTurn))
      return unavailable('turn_cap', s.criteriaVersion);

    const body = JSON.stringify({
      model: s.model,
      state: q.state,
      questions: {
        verdict: {
          type: 'choice',
          instructions: `${q.instructions} (criterios ${s.criteriaVersion})`,
          criteria: q.criteria,
        },
      },
    });

    let attempt = await this.post(s, body);
    if (!attempt.ok && attempt.retryable && s.maxRetries > 0)
      attempt = await this.post(s, body);
    if (!attempt.ok) return unavailable(attempt.reason, s.criteriaVersion);

    const answer = record(record(record(attempt.body)?.answers)?.verdict);
    if (!answer) return unavailable('invalid_response', s.criteriaVersion);
    if (answer.type === 'refusal')
      return unavailable('refusal', s.criteriaVersion);
    const choice = answer.choice;
    if (
      answer.type !== 'choice' ||
      typeof choice !== 'string' ||
      !Object.prototype.hasOwnProperty.call(q.criteria, choice)
    )
      return unavailable('invalid_response', s.criteriaVersion);
    const confidence =
      typeof answer.confidence === 'number' &&
      Number.isFinite(answer.confidence)
        ? answer.confidence
        : null;
    if (
      s.minConfidence > 0 &&
      (confidence === null || confidence < s.minConfidence)
    )
      return unavailable('low_confidence', s.criteriaVersion);
    return {
      value: choice as T,
      confidence,
      criteria_version: s.criteriaVersion,
      latency_ms: Date.now() - started,
    };
  }

  private async post(
    s: ClassifierSettings,
    body: string,
  ): Promise<AttemptResult> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<AttemptResult>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve({ ok: false, reason: 'timeout', retryable: true });
      }, s.timeoutMs);
    });
    const call = (async (): Promise<AttemptResult> => {
      try {
        const res = await this.http(s.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${s.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
        });
        if (res.status < 200 || res.status >= 300) {
          return {
            ok: false,
            reason: 'http_error',
            status: res.status,
            retryable: res.status === 429 || res.status >= 500,
          };
        }
        return { ok: true, body: await res.json() };
      } catch {
        return timedOut
          ? { ok: false, reason: 'timeout', retryable: true }
          : { ok: false, reason: 'network_error', retryable: true };
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
    if (!config.model_id) return { ok: false, reason: 'config_error' };

    const ref = config.api_key_ref?.trim() ?? '';
    const apiKey = ENV_NAME.test(ref) ? (process.env[ref] ?? '').trim() : '';
    if (!apiKey) return { ok: false, reason: 'no_api_key' };

    const retry = record(app.retry_config) ?? {};
    const rate = record(app.rate_limit) ?? {};
    const meta = record(app.metadata) ?? {};
    const timeoutRaw = Number(retry.timeout_ms);
    const timeoutMs = Number.isFinite(timeoutRaw)
      ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutRaw))
      : DEFAULT_TIMEOUT_MS;
    const capRaw = Number(rate.max_calls_per_turn);
    const maxCallsPerTurn =
      Number.isInteger(capRaw) && capRaw >= 0
        ? capRaw
        : DEFAULT_MAX_CALLS_PER_TURN;
    const minRaw = Number(meta.min_confidence);
    const minConfidence =
      Number.isFinite(minRaw) && minRaw >= 0 && minRaw <= 1
        ? minRaw
        : DEFAULT_MIN_CONFIDENCE;
    const version =
      typeof meta.criteria_version === 'string' &&
      /^[\w.-]{1,20}$/.test(meta.criteria_version)
        ? meta.criteria_version
        : DEFAULT_CRITERIA_VERSION;
    const base = config.base_url?.trim();
    return {
      ok: true,
      settings: {
        endpoint: base && /^https:\/\//.test(base) ? base : DECISIONS_ENDPOINT,
        model: config.model_id,
        apiKey,
        timeoutMs,
        maxRetries: Number(retry.max_retries) === 0 ? 0 : 1,
        maxCallsPerTurn,
        criteriaVersion: version,
        minConfidence,
      },
    };
  }

  /**
   * One turn = one request (`X-Request-Id`). Without a request id each call
   * is its own turn, so the cap still bounds a single call site.
   */
  private takeTurnSlot(max: number): boolean {
    const now = Date.now();
    if (this.turnCalls.size > MAX_TRACKED_TURNS) {
      for (const [key, entry] of this.turnCalls)
        if (now - entry.at > TURN_COUNTER_TTL_MS) this.turnCalls.delete(key);
      if (this.turnCalls.size > MAX_TRACKED_TURNS) this.turnCalls.clear();
    }
    const key = RequestContextService.getRequestId() ?? randomUUID();
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
          ...(reason ? { classifier_degradation: reason } : {}),
        },
      });
    } catch {
      // Telemetry never affects the turn.
    }
    this.logger.debug(
      `vex_classifier question=${question} verdict=${verdict.value}${reason ? ` reason=${reason}` : ''} latency_ms=${verdict.latency_ms}`,
    );
  }
}
