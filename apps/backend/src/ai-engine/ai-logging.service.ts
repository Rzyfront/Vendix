import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import {
  AILogEntry,
  AIUsageStatsFilter,
  AIUsageStats,
  TenantUsageStats,
} from './interfaces/ai-log.interface';

@Injectable()
export class AILoggingService {
  private readonly logger = new Logger(AILoggingService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async logRequest(entry: AILogEntry): Promise<void> {
    try {
      await this.prisma.ai_engine_logs.create({
        data: {
          app_key: entry.app_key,
          config_id: entry.config_id,
          organization_id: entry.organization_id,
          store_id: entry.store_id,
          user_id: entry.user_id,
          model: entry.model,
          prompt_tokens: entry.prompt_tokens,
          completion_tokens: entry.completion_tokens,
          cost_usd: entry.cost_usd,
          latency_ms: entry.latency_ms,
          status: entry.status,
          error_message: entry.error_message,
          input_preview: entry.input_preview?.substring(0, 500),
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to log AI request: ${error.message}`);
    }
  }

  calculateCost(
    configSettings: Record<string, any> | undefined,
    promptTokens: number,
    completionTokens: number,
  ): number {
    const pricing = configSettings?.pricing as
      | { input_per_1k?: number; output_per_1k?: number }
      | undefined;

    if (!pricing) return 0;

    const inputCost = (promptTokens / 1000) * (pricing.input_per_1k ?? 0);
    const outputCost = (completionTokens / 1000) * (pricing.output_per_1k ?? 0);

    return Number((inputCost + outputCost).toFixed(8));
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
