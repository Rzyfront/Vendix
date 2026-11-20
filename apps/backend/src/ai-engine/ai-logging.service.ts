import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RequestContextService } from '../common/context/request-context.service';
import {
  AgentTraceService,
  hashTraceValue,
  normalizeRequestId,
  redactTraceAttributes,
} from './observability/agent-trace.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import {
  AILogEntry,
  AIUsageStatsFilter,
  AIUsageStats,
  AIAppHealthReport,
  AIAppHealthRow,
  TenantUsageStats,
} from './interfaces/ai-log.interface';

/** `ai_engine_logs.validation_error` is VARCHAR(500). */
export const VALIDATION_ERROR_MAX_CHARS = 500;
/** Default window of the per-app health board. */
export const APP_HEALTH_DEFAULT_DAYS = 7;
/** Widest window the board accepts (one aggregate scan, never rows). */
export const APP_HEALTH_MAX_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Raw aggregate row; Postgres COUNT/SUM come back as bigint. */
interface AppHealthSqlRow {
  app_key: string | null;
  total_calls: bigint | number;
  error_calls: bigint | number;
  truncated_calls: bigint | number;
  validation_failed_calls: bigint | number;
  avg_prompt_tokens: number | string | null;
  avg_completion_tokens: number | string | null;
}

/**
 * Measured prompt cache (remediation step 8): cache token counts carried
 * alongside {@link AILogEntry}. Kept here so `logRequest()` stays callable
 * with a plain `AILogEntry` — callers that do not know about caching keep
 * compiling and their rows default to 0.
 */
export interface AICacheLogFields {
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
}

@Injectable()
export class AILoggingService {
  private readonly logger = new Logger(AILoggingService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Optional() private readonly trace?: AgentTraceService,
  ) {}

  async logRequest(entry: AILogEntry & AICacheLogFields): Promise<void> {
    try {
      const correlation = this.trace?.currentTraceContext();
      const externalId =
        entry.request_id ??
        RequestContextService.asyncLocalStorage.getStore()?.request_id;
      const requestId = normalizeRequestId(
        externalId ?? correlation?.request_id,
      );
      const externalHash =
        externalId && !this.isUuid(externalId)
          ? hashTraceValue(externalId)
          : undefined;
      await this.prisma.ai_engine_logs.create({
        select: { id: true },
        data: {
          request_id: requestId,
          ...{
            trace_id: correlation?.trace_id ?? this.safeUuid(entry.trace_id),
            span_id: correlation?.span_id ?? this.safeUuid(entry.span_id),
            objective_id:
              correlation?.objective_id ?? this.safeUuid(entry.objective_id),
            conversation_id:
              correlation?.conversation_id ??
              this.safeConversationId(entry.conversation_id),
            turn_id: correlation?.turn_id ?? this.safeUuid(entry.turn_id),
            provider_call_id:
              correlation?.provider_call_id ??
              this.safeUuid(entry.provider_call_id),
            attempt_id:
              correlation?.attempt_id ?? this.safeUuid(entry.attempt_id),
            tool_call_id:
              correlation?.tool_call_id ?? this.safeUuid(entry.tool_call_id),
            external_request_id_hash:
              externalHash ?? this.safeHash(entry.external_request_id_hash),
            usage_observed: {
              prompt_tokens: this.tokenCount(
                entry.usage_observed?.prompt_tokens,
              ),
              completion_tokens: this.tokenCount(
                entry.usage_observed?.completion_tokens,
              ),
              cache_read_tokens: this.tokenCount(
                entry.usage_observed?.cache_read_tokens,
              ),
              cache_creation_tokens: this.tokenCount(
                entry.usage_observed?.cache_creation_tokens,
              ),
            },
            cost_source: 'logical_summary',
            telemetry_metadata: redactTraceAttributes(entry.telemetry_metadata),
          },
          app_key: entry.app_key,
          config_id: entry.config_id,
          organization_id: entry.organization_id,
          store_id: entry.store_id,
          user_id: entry.user_id,
          model: entry.model,
          prompt_tokens: entry.prompt_tokens,
          completion_tokens: entry.completion_tokens,
          cache_read_tokens: entry.cache_read_tokens ?? 0,
          cache_creation_tokens: entry.cache_creation_tokens ?? 0,
          cost_usd: entry.cost_usd,
          latency_ms: entry.latency_ms,
          status: entry.status,
          // Provider error messages may echo prompts, URLs and credentials.
          error_message: entry.error_message
            ? '[redacted]'
            : entry.error_message,
          input_preview: undefined,
          finish_reason: this.safeFinishReason(entry.finish_reason),
          attempt: this.safeAttempt(entry.attempt),
          validation_error: this.safeValidationError(entry.validation_error),
        },
      });
    } catch (error: any) {
      // Prisma errors may contain the rejected data, including legacy previews.
      this.logger.error('Failed to log AI request');
    }
  }

  private safeFinishReason(value?: string): string | undefined {
    return typeof value === 'string' && /^[a-z_]{1,32}$/.test(value)
      ? value
      : undefined;
  }

  private safeAttempt(value?: number): number | undefined {
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 1000
      ? value
      : undefined;
  }

  private safeValidationError(value?: string): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, VALIDATION_ERROR_MAX_CHARS) : undefined;
  }

  private safeUuid(value?: string): string | undefined {
    return value && this.isUuid(value) ? value.toLowerCase() : undefined;
  }

  private safeHash(value?: string): string | undefined {
    return value && /^[0-9a-f]{64}$/.test(value) ? value : undefined;
  }

  private safeConversationId(value?: string): string | undefined {
    if (!value) return undefined;
    return this.isUuid(value) || /^\d{1,16}$/.test(value)
      ? value
      : hashTraceValue(value);
  }

  private tokenCount(value?: number | null): number | null {
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 2_147_483_647
      ? value
      : null;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  calculateCost(
    configSettings: Record<string, any> | undefined,
    promptTokens: number,
    completionTokens: number,
    cacheReadTokens = 0,
    cacheCreationTokens = 0,
  ): number {
    const pricing = configSettings?.pricing as
      | {
          input_per_1k?: number;
          output_per_1k?: number;
          cache_read_per_1k?: number;
          cache_creation_per_1k?: number;
        }
      | undefined;

    if (!pricing) return 0;

    const inputCost = (promptTokens / 1000) * (pricing.input_per_1k ?? 0);
    const outputCost = (completionTokens / 1000) * (pricing.output_per_1k ?? 0);
    // Provider cache rate applies only when configured; otherwise the cache
    // tokens are recorded by logRequest() but leave the cost unchanged
    // (count-only).
    const cacheReadCost =
      (cacheReadTokens / 1000) * (pricing.cache_read_per_1k ?? 0);
    const cacheCreationCost =
      (cacheCreationTokens / 1000) * (pricing.cache_creation_per_1k ?? 0);

    return Number(
      (inputCost + outputCost + cacheReadCost + cacheCreationCost).toFixed(8),
    );
  }

  async getUsageStats(filter: AIUsageStatsFilter): Promise<AIUsageStats> {
    const cacheKey = `ai:usage-stats:${JSON.stringify(filter)}`;
    const cached = await this.cache.get<AIUsageStats>(cacheKey);
    if (cached) return cached;

    const where: any = {};
    if (filter.organization_id) where.organization_id = filter.organization_id;
    if (filter.store_id) where.store_id = filter.store_id;
    if (filter.app_key) where.app_key = filter.app_key;
    if (filter.date_from || filter.date_to) {
      where.created_at = {};
      if (filter.date_from) where.created_at.gte = filter.date_from;
      if (filter.date_to) where.created_at.lte = filter.date_to;
    }

    const [aggregates, byModel, byAppKey] = await Promise.all([
      this.prisma.ai_engine_logs.aggregate({
        where,
        _count: { id: true },
        _sum: {
          prompt_tokens: true,
          completion_tokens: true,
          cost_usd: true,
          latency_ms: true,
        },
        _avg: { latency_ms: true },
      }),
      this.prisma.ai_engine_logs.groupBy({
        by: ['model'],
        where: { ...where, model: { not: null } },
        _count: { id: true },
        _sum: {
          prompt_tokens: true,
          completion_tokens: true,
          cost_usd: true,
        },
      }),
      this.prisma.ai_engine_logs.groupBy({
        by: ['app_key'],
        where: { ...where, app_key: { not: null } },
        _count: { id: true },
        _sum: {
          prompt_tokens: true,
          completion_tokens: true,
          cost_usd: true,
        },
        _avg: { latency_ms: true },
      }),
    ]);

    const successCount = await this.prisma.ai_engine_logs.count({
      where: { ...where, status: 'success' },
    });

    const totalRequests = aggregates._count.id;

    const stats: AIUsageStats = {
      total_requests: totalRequests,
      successful_requests: successCount,
      failed_requests: totalRequests - successCount,
      total_prompt_tokens: aggregates._sum.prompt_tokens ?? 0,
      total_completion_tokens: aggregates._sum.completion_tokens ?? 0,
      total_tokens:
        (aggregates._sum.prompt_tokens ?? 0) +
        (aggregates._sum.completion_tokens ?? 0),
      total_cost_usd: Number(aggregates._sum.cost_usd ?? 0),
      avg_latency_ms: Math.round(Number(aggregates._avg.latency_ms ?? 0)),
      by_model: byModel.map((m) => ({
        model: m.model ?? 'unknown',
        count: m._count.id,
        total_tokens:
          (m._sum.prompt_tokens ?? 0) + (m._sum.completion_tokens ?? 0),
        total_cost_usd: Number(m._sum.cost_usd ?? 0),
      })),
      by_app_key: byAppKey.map((a) => ({
        app_key: a.app_key ?? 'unknown',
        count: a._count.id,
        total_tokens:
          (a._sum.prompt_tokens ?? 0) + (a._sum.completion_tokens ?? 0),
        total_cost_usd: Number(a._sum.cost_usd ?? 0),
        avg_latency_ms: Math.round(Number(a._avg.latency_ms ?? 0)),
      })),
    };

    await this.cache.set(cacheKey, stats, 30 * 1000);
    return stats;
  }

  /**
   * Per-app health board (super admin): calls, % error, % cut
   * (`finish_reason = 'length'`), % rejected by validation and average tokens
   * per call, in ONE aggregate query (no rows reach memory). Default window:
   * the last {@link APP_HEALTH_DEFAULT_DAYS} days; wider than
   * {@link APP_HEALTH_MAX_DAYS} is clamped from `date_to` backwards.
   */
  async getAppHealth(filter: {
    date_from?: Date;
    date_to?: Date;
    app_key?: string;
  }): Promise<AIAppHealthReport> {
    const dateTo = this.validDate(filter.date_to) ?? new Date();
    let dateFrom =
      this.validDate(filter.date_from) ??
      new Date(dateTo.getTime() - APP_HEALTH_DEFAULT_DAYS * DAY_MS);
    if (dateFrom.getTime() > dateTo.getTime()) {
      dateFrom = new Date(dateTo.getTime() - APP_HEALTH_DEFAULT_DAYS * DAY_MS);
    }
    const earliest = dateTo.getTime() - APP_HEALTH_MAX_DAYS * DAY_MS;
    if (dateFrom.getTime() < earliest) dateFrom = new Date(earliest);

    const appKey = filter.app_key?.trim().slice(0, 100) || undefined;
    const cacheKey = `ai:app-health:${dateFrom.toISOString()}:${dateTo.toISOString()}:${appKey ?? ''}`;
    const cached = await this.cache.get<AIAppHealthReport>(cacheKey);
    if (cached) return cached;

    const appFilter = appKey
      ? Prisma.sql`AND app_key = ${appKey}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<AppHealthSqlRow[]>(Prisma.sql`
      SELECT app_key,
             COUNT(*) AS total_calls,
             COUNT(*) FILTER (WHERE status = 'error') AS error_calls,
             COUNT(*) FILTER (WHERE finish_reason = 'length') AS truncated_calls,
             COUNT(*) FILTER (WHERE validation_error IS NOT NULL) AS validation_failed_calls,
             AVG(prompt_tokens) AS avg_prompt_tokens,
             AVG(completion_tokens) AS avg_completion_tokens
        FROM ai_engine_logs
       WHERE created_at >= ${dateFrom}
         AND created_at <= ${dateTo}
         AND app_key IS NOT NULL
         ${appFilter}
       GROUP BY app_key
       ORDER BY COUNT(*) DESC, app_key ASC
       LIMIT 500
    `);

    const report: AIAppHealthReport = {
      date_from: dateFrom.toISOString(),
      date_to: dateTo.toISOString(),
      apps: rows.map((row) => this.toHealthRow(row)),
    };
    await this.cache.set(cacheKey, report, 30 * 1000);
    return report;
  }

  private toHealthRow(row: AppHealthSqlRow): AIAppHealthRow {
    const total = Number(row.total_calls) || 0;
    const errors = Number(row.error_calls) || 0;
    const truncated = Number(row.truncated_calls) || 0;
    const invalid = Number(row.validation_failed_calls) || 0;
    const avgPrompt = Math.round(Number(row.avg_prompt_tokens ?? 0) || 0);
    const avgCompletion = Math.round(
      Number(row.avg_completion_tokens ?? 0) || 0,
    );
    const rate = (part: number) =>
      total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
    return {
      app_key: row.app_key ?? 'unknown',
      total_calls: total,
      error_calls: errors,
      truncated_calls: truncated,
      validation_failed_calls: invalid,
      error_rate: rate(errors),
      truncated_rate: rate(truncated),
      validation_failed_rate: rate(invalid),
      avg_prompt_tokens: avgPrompt,
      avg_completion_tokens: avgCompletion,
      avg_total_tokens: avgPrompt + avgCompletion,
    };
  }

  private validDate(value?: Date): Date | undefined {
    return value instanceof Date && !Number.isNaN(value.getTime())
      ? value
      : undefined;
  }

  async getUsageByTenant(
    organizationId: number,
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<TenantUsageStats> {
    const cacheKey = `ai:tenant-usage:${organizationId}:${dateFrom?.toISOString()}:${dateTo?.toISOString()}`;
    const cached = await this.cache.get<TenantUsageStats>(cacheKey);
    if (cached) return cached;

    const where: any = { organization_id: organizationId };
    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = dateFrom;
      if (dateTo) where.created_at.lte = dateTo;
    }

    const [aggregates, byStore] = await Promise.all([
      this.prisma.ai_engine_logs.aggregate({
        where,
        _count: { id: true },
        _sum: {
          prompt_tokens: true,
          completion_tokens: true,
          cost_usd: true,
        },
      }),
      this.prisma.ai_engine_logs.groupBy({
        by: ['store_id'],
        where: { ...where, store_id: { not: null } },
        _count: { id: true },
        _sum: {
          prompt_tokens: true,
          completion_tokens: true,
          cost_usd: true,
        },
      }),
    ]);

    const stats: TenantUsageStats = {
      organization_id: organizationId,
      total_requests: aggregates._count.id,
      total_tokens:
        (aggregates._sum.prompt_tokens ?? 0) +
        (aggregates._sum.completion_tokens ?? 0),
      total_cost_usd: Number(aggregates._sum.cost_usd ?? 0),
      by_store: byStore.map((s) => ({
        store_id: s.store_id!,
        count: s._count.id,
        total_tokens:
          (s._sum.prompt_tokens ?? 0) + (s._sum.completion_tokens ?? 0),
        total_cost_usd: Number(s._sum.cost_usd ?? 0),
      })),
    };

    await this.cache.set(cacheKey, stats, 30 * 1000);
    return stats;
  }
}
