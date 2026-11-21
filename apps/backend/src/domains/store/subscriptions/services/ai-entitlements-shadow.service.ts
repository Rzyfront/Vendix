import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { AI_CAPABILITIES, aiCapabilityId } from '../types/ai-capabilities';
import type { AIFeatureKey, ResolvedFeatures } from '../types/access.types';
import {
  AIEntitlementDiff,
  aiEntitlementDiffSignature,
  compareAIEntitlements,
} from './ai-entitlements.logic';
import { AIEntitlementsResolverService } from './ai-entitlements-resolver.service';

const COUNTER_PREFIX = 'ai:entitlements:shadow';
const COUNTER_TTL_SECONDS = 40 * 24 * 60 * 60;
const LOG_DEDUPE_TTL_SECONDS = 2 * 24 * 60 * 60;
const REPORT_DAYS = 14;

export interface AIEntitlementsShadowPlanReport {
  plan_id: number;
  code: string;
  name: string;
  state: string;
  source: 'table' | 'legacy_fallback';
  differences: AIEntitlementDiff[];
}

export interface AIEntitlementsShadowRuntimeDay {
  day: string;
  /** Gate checks with at least one divergence. */
  count: number;
  checks: number;
  new_model_only: number;
}

export interface AIEntitlementsShadowReport {
  generated_at: string;
  shadow_enabled: boolean;
  plans_checked: number;
  /** Only plans with at least one difference. */
  plans: AIEntitlementsShadowPlanReport[];
  total_divergences: number;
  total_new_model_only: number;
  runtime: {
    days: AIEntitlementsShadowRuntimeDay[];
    total: number;
    divergent_stores: number[];
  };
}

/**
 * Shadow mode of the AI entitlements model (T10).
 *
 * The gate keeps deciding with `ai_feature_flags`; on each AI gate check this
 * service resolves the new model for the same store, compares the
 * capabilities of the legacy feature being decided and records the outcome:
 * a per-day Redis counter and one `AI_ENTITLEMENT_SHADOW_DIFF` warning per
 * store/difference/day. The superadmin report adds the per-plan structural
 * comparison. The new model replaces the legacy one only when both reach zero
 * divergences.
 *
 * Off switch: `AI_ENTITLEMENTS_SHADOW=false`.
 */
@Injectable()
export class AIEntitlementsShadowService {
  private readonly logger = new Logger(AIEntitlementsShadowService.name);

  constructor(
    private readonly entitlements: AIEntitlementsResolverService,
    private readonly prisma: GlobalPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  isEnabled(): boolean {
    return process.env.AI_ENTITLEMENTS_SHADOW !== 'false';
  }

  /**
   * Fire-and-forget hook for the gate. Never throws, never awaited by the
   * caller: the gate result does not depend on it. Legacy features without a
   * capability (conversations, tool_agents, async_queue) are not compared.
   */
  observe(
    storeId: number,
    feature: AIFeatureKey,
    legacyFeatures: ResolvedFeatures,
  ): void {
    if (!this.isEnabled()) return;
    if (!AI_CAPABILITIES.some((c) => c.legacy?.feature === feature)) return;
    this.compareAndRecord(storeId, feature, legacyFeatures).catch((err) =>
      this.logger.warn(
        `AI entitlements shadow failed for store ${storeId} (${feature}): ${(err as Error).message}`,
      ),
    );
  }

  async compareAndRecord(
    storeId: number,
    feature: AIFeatureKey,
    legacyFeatures: ResolvedFeatures,
  ): Promise<AIEntitlementDiff[]> {
    const resolved = await this.entitlements.resolveForStore(storeId);
    const diffs = compareAIEntitlements(
      legacyFeatures,
      resolved.rows,
      (def) => def.legacy?.feature === feature,
    );
    const divergences = diffs.filter((d) => d.kind === 'divergence');
    const day = utcDay(new Date());
    const key = `${COUNTER_PREFIX}:${day}`;

    const tx = this.redis.multi();
    tx.hincrby(key, 'checks', 1);
    if (divergences.length) {
      tx.hincrby(key, 'divergent', 1);
      tx.hincrby(key, `store:${storeId}`, 1);
    }
    if (diffs.length > divergences.length) tx.hincrby(key, 'new_model_only', 1);
    tx.expire(key, COUNTER_TTL_SECONDS);
    await tx.exec();

    if (divergences.length) {
      const signature = createHash('sha1')
        .update(aiEntitlementDiffSignature(divergences))
        .digest('hex')
        .slice(0, 16);
      const first = await this.redis.set(
        `${COUNTER_PREFIX}:seen:${day}:${storeId}:${signature}`,
        '1',
        'EX',
        LOG_DEDUPE_TTL_SECONDS,
        'NX',
      );
      if (first) {
        this.logger.warn(
          `AI_ENTITLEMENT_SHADOW_DIFF ${JSON.stringify({
            store_id: storeId,
            feature,
            plan_id: resolved.planId,
            base_source: resolved.baseSource,
            partner_restricted: resolved.partnerRestricted,
            overlay_active: resolved.overlayActive,
            divergences,
          })}`,
        );
      }
    }
    return diffs;
  }

  /** Superadmin report: per-plan structural comparison + runtime counters. */
  async buildReport(now = new Date()): Promise<AIEntitlementsShadowReport> {
    const plans = await this.prisma.subscription_plans.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        state: true,
        ai_feature_flags: true,
        ai_entitlements: {
          select: {
            agent_key: true,
            capability_key: true,
            enabled: true,
            cap_value: true,
            on_limit: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    const planReports: AIEntitlementsShadowPlanReport[] = [];
    for (const plan of plans) {
      const { rows, source } = this.entitlements.planEntitlements(plan);
      const stored = new Set(
        plan.ai_entitlements.map((r) => `${r.agent_key}.${r.capability_key}`),
      );
      const missing: AIEntitlementDiff[] = AI_CAPABILITIES.filter(
        (def) => !stored.has(aiCapabilityId(def.agent_key, def.capability_key)),
      ).map((def) => ({
        capability: aiCapabilityId(def.agent_key, def.capability_key),
        kind: 'divergence',
        legacy: 'según ai_feature_flags',
        current: 'sin fila en plan_ai_entitlements',
      }));
      const differences = [
        ...missing,
        ...compareAIEntitlements(plan.ai_feature_flags, rows),
      ];
      if (differences.length) {
        planReports.push({
          plan_id: plan.id,
          code: plan.code,
          name: plan.name,
          state: String(plan.state),
          source,
          differences,
        });
      }
    }

    const runtime = await this.readRuntime(now);
    const all = planReports.flatMap((p) => p.differences);
    return {
      generated_at: now.toISOString(),
      shadow_enabled: this.isEnabled(),
      plans_checked: plans.length,
      plans: planReports,
      total_divergences: all.filter((d) => d.kind === 'divergence').length,
      total_new_model_only: all.filter((d) => d.kind === 'new_model_only')
        .length,
      runtime,
    };
  }

  private async readRuntime(
    now: Date,
  ): Promise<AIEntitlementsShadowReport['runtime']> {
    const days: AIEntitlementsShadowRuntimeDay[] = [];
    const stores = new Set<number>();
    for (let i = 0; i < REPORT_DAYS; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const day = utcDay(date);
      const hash = (await this.redis.hgetall(`${COUNTER_PREFIX}:${day}`)) ?? {};
      const checks = toInt(hash.checks);
      if (!checks) continue;
      for (const field of Object.keys(hash)) {
        if (field.startsWith('store:')) stores.add(toInt(field.slice(6)));
      }
      days.push({
        day: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`,
        count: toInt(hash.divergent),
        checks,
        new_model_only: toInt(hash.new_model_only),
      });
    }
    return {
      days,
      total: days.reduce((acc, d) => acc + d.count, 0),
      divergent_stores: [...stores].filter((s) => s > 0).sort((a, b) => a - b),
    };
  }
}

function utcDay(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function toInt(raw: string | undefined): number {
  const n = parseInt(raw ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}
