import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { dateOnlyString, localCivil, localDateString, resolveStoreTimezone } from '../../../../common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { WorkflowAnalyticsReport, WorkflowAnalyticsService } from '../metrics/workflow-analytics.service';
import {
  INSIGHTS_FAILED_ERROR,
  INSIGHTS_INVALID_ERROR,
  INSIGHTS_LIMITS,
  INSIGHTS_QUOTA_ERROR,
  InsightsFlowRef,
  WorkflowInsightsContent,
  WorkflowInsightsFlowInput,
  WorkflowInsightsTotals,
  addDaysToDateString,
  emptyInsightsContent,
  isoWeekKey,
  parseInsightsContent,
} from './workflow-insights.content';
import { WORKFLOW_INSIGHTS_APP_KEY, WorkflowAiService } from './workflow-ai.service';
import { WorkflowAccessPolicy } from '../access/workflow-access.policy';

export const INSIGHTS_WINDOW_DAYS = 30;
export const INSIGHTS_MANUAL_COOLDOWN_MS = 60 * 60 * 1000;
export const INSIGHTS_URL = '/admin/workflows/insights';
export const INSIGHTS_NOTIFICATION_TITLE = 'Resumen semanal de Flujos listo';
const MANUAL_LOCK_SECONDS = 120;
/** A failed weekly summary is retried by the next hourly runs, at most this many times. */
export const INSIGHTS_WEEKLY_MAX_RETRIES = 3;
const WEEKLY_RETRY_TTL_SECONDS = 8 * 24 * 60 * 60;

export type WorkflowInsightsKind = 'weekly' | 'manual';
export type WorkflowInsightsStatus = 'ready' | 'failed' | 'skipped_quota';

export interface WorkflowInsightsSummary {
  id: number;
  kind: WorkflowInsightsKind;
  status: WorkflowInsightsStatus;
  period_from: string;
  period_to: string;
  week_key: string | null;
  content: WorkflowInsightsContent | null;
  tokens_used: number;
  model: string | null;
  error: string | null;
  created_at: string;
}

export interface WorkflowInsightsList {
  items: WorkflowInsightsSummary[];
  can_generate: boolean;
  next_generate_at: string | null;
}

interface SummaryRow {
  id: number;
  kind: string;
  status: string;
  period_from: Date;
  period_to: Date;
  week_key: string | null;
  content: unknown;
  tokens_used: number;
  model: string | null;
  error: string | null;
  created_at: Date;
}

interface Outcome {
  status: WorkflowInsightsStatus;
  content: WorkflowInsightsContent | null;
  tokens: number;
  model: string | null;
  error: string | null;
}

interface Period {
  from: string;
  to: string;
  timezone: string;
}

/**
 * P6.4: the AI narrative of the Flows analytics. It feeds the AI only with the
 * aggregated metrics of the last 30 days of each published flow (no request
 * content, no personal names), validates the answer strictly and stores one
 * row per generation. Weekly rows are unique per store and ISO week.
 */
@Injectable()
export class WorkflowInsightsService {
  private readonly logger = new Logger(WorkflowInsightsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly analytics: WorkflowAnalyticsService,
    private readonly ai: WorkflowAiService,
    private readonly notifications: NotificationsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly access: WorkflowAccessPolicy,
  ) {}

  async list(limit: number, canManage: boolean, now = new Date()): Promise<WorkflowInsightsList> {
    const storeId = this.storeId();
    const [rows, lastManual, hidden] = await Promise.all([
      this.prisma.workflow_ai_summaries.findMany({
        where: { store_id: storeId },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: limit,
      }) as Promise<SummaryRow[]>,
      this.lastManual(storeId),
      this.access.hiddenDefinitionIds(),
    ]);
    const coolsDownUntil = cooldownEnd(lastManual, now);
    const hiddenIds = new Set(hidden);
    return {
      items: rows.map((row) => present(row, hiddenIds)),
      can_generate: canManage && coolsDownUntil === null,
      next_generate_at: coolsDownUntil ? coolsDownUntil.toISOString() : null,
    };
  }

  /** On-demand summary: one per store per hour, serialized against double clicks. */
  async generateManual(now = new Date()): Promise<WorkflowInsightsSummary> {
    const storeId = this.storeId();
    const lockKey = `workflows:insights:manual-lock:${storeId}`;
    const claimed = await this.redis.set(lockKey, '1', 'EX', MANUAL_LOCK_SECONDS, 'NX');
    if (claimed !== 'OK') throw new VendixHttpException(ErrorCodes.WORKFLOW_INSIGHTS_RATE_LIMITED);
    try {
      if (cooldownEnd(await this.lastManual(storeId), now)) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_INSIGHTS_RATE_LIMITED);
      }
      const row = await this.generate('manual', null, now);
      if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_INSIGHTS_RATE_LIMITED);
      return present(row);
    } finally {
      await this.redis.del(lockKey);
    }
  }

  /**
   * Weekly summary of the current store for the ISO week of `now` (store-local).
   * Returns null when the week already has its summary. A `failed` one (the
   * provider was down, the answer was invalid) is regenerated in place by the
   * next runs, at most INSIGHTS_WEEKLY_MAX_RETRIES times a week.
   */
  async generateWeekly(now = new Date()): Promise<WorkflowInsightsSummary | null> {
    const storeId = this.storeId();
    const timezone = await resolveStoreTimezone(this.prisma, storeId);
    const civil = localCivil(now, timezone);
    const weekKey = isoWeekKey(civil.year, civil.month, civil.day);
    const existing = (await this.prisma.workflow_ai_summaries.findFirst({
      where: { store_id: storeId, week_key: weekKey },
      select: { id: true, status: true },
    })) as { id: number; status: string } | null;
    if (existing && (existing.status !== 'failed' || !(await this.claimWeeklyRetry(storeId, weekKey)))) {
      return null;
    }

    const row = await this.generate('weekly', weekKey, now, existing?.id ?? null);
    if (!row) return null;
    const summary = present(row);
    if (summary.status === 'ready' && summary.content) {
      await this.notify(storeId, summary);
    }
    return summary;
  }

  /** Counts the retries of one failed week (Redis INCR); false once they are used up. */
  private async claimWeeklyRetry(storeId: number, weekKey: string): Promise<boolean> {
    const key = `workflows:insights:weekly-retry:${storeId}:${weekKey}`;
    const attempt = await this.redis.incr(key);
    if (attempt === 1) await this.redis.expire(key, WEEKLY_RETRY_TTL_SECONDS);
    return attempt <= INSIGHTS_WEEKLY_MAX_RETRIES;
  }

  private async generate(
    kind: WorkflowInsightsKind,
    weekKey: string | null,
    now: Date,
    /** Failed weekly row to regenerate in place (the week is unique per store). */
    replaceId: number | null = null,
  ): Promise<SummaryRow | null> {
    const storeId = this.storeId();
    const timezone = await resolveStoreTimezone(this.prisma, storeId);
    const to = localDateString(now, timezone);
    const period: Period = { from: addDaysToDateString(to, -(INSIGHTS_WINDOW_DAYS - 1)), to, timezone };

    // Everyone with read permission gets this summary, so a flow some staff
    // member may not see never reaches the AI (P7.3).
    const restricted = new Set(await this.access.restrictedDefinitionIds());
    const definitions = ((await this.prisma.workflow_definitions.findMany({
      where: { store_id: storeId, status: 'active', published_version_id: { not: null } },
      select: { id: true, key: true, name: true },
      orderBy: { id: 'asc' },
    })) as Array<{ id: number; key: string; name: string }>).filter((d) => !restricted.has(d.id));

    const flows: WorkflowInsightsFlowInput[] = [];
    for (const def of definitions) {
      try {
        flows.push(flowInput(def.key, def.name, await this.analytics.report(def.id, { from: period.from, to: period.to })));
      } catch (e) {
        // One flow whose metrics fail must not cost the store its summary.
        this.logger.warn(`Insights metrics of flow ${def.id} failed: ${(e as Error)?.message}`);
      }
    }
    // Only the busiest flows reach the AI: the answer may narrate at most
    // INSIGHTS_LIMITS.flows of them, and a key it was not given is dropped.
    const narrated = flowsToNarrate(flows);
    const narratedKeys = new Set(narrated.map((f) => f.key));
    const refs = new Map<string, InsightsFlowRef>(
      definitions
        .filter((d) => narratedKeys.has(d.key))
        .map((d) => [d.key, { definition_id: d.id, name: d.name }]),
    );

    const totals = storeTotals(flows);
    const outcome = narrated.length > 0
      ? await this.narrate(period, totals, narrated, refs)
      : { status: 'ready' as const, content: emptyInsightsContent(definitions.length > 0), tokens: 0, model: null, error: null };

    const data = {
      period_from: new Date(`${period.from}T00:00:00Z`),
      period_to: new Date(`${period.to}T00:00:00Z`),
      status: outcome.status,
      content: outcome.content ? (outcome.content as unknown as object) : undefined,
      metrics: { period, totals, flows } as unknown as object,
      model: outcome.model,
      tokens_used: outcome.tokens,
      error: outcome.error,
    };
    if (replaceId !== null) {
      // Only a row that is still failed is replaced: never a summary that
      // another run already completed.
      const { count } = await this.prisma.workflow_ai_summaries.updateMany({
        where: { id: replaceId, store_id: storeId, status: 'failed' },
        data: { ...data, created_at: now },
      });
      if (count === 0) return null;
      return (await this.prisma.workflow_ai_summaries.findFirst({
        where: { id: replaceId, store_id: storeId },
      })) as SummaryRow | null;
    }
    try {
      return (await this.prisma.workflow_ai_summaries.create({
        data: {
          ...data,
          store_id: storeId,
          kind,
          week_key: weekKey,
          created_by_user_id: kind === 'manual' ? (RequestContextService.getUserId() ?? null) : null,
        },
      })) as SummaryRow;
    } catch (e) {
      if (kind === 'weekly' && isUniqueViolation(e)) return null;
      throw e;
    }
  }

  private async narrate(
    period: Period,
    totals: WorkflowInsightsTotals,
    flows: WorkflowInsightsFlowInput[],
    refs: ReadonlyMap<string, InsightsFlowRef>,
  ): Promise<Outcome> {
    const result = await this.ai.run({
      appKey: WORKFLOW_INSIGHTS_APP_KEY,
      purpose: 'insights_summary',
      messages: [{ role: 'user', content: JSON.stringify({ period: { from: period.from, to: period.to }, totals, flows }) }],
    });
    if (result.status === 'skipped_quota') {
      return { status: 'skipped_quota', content: null, tokens: 0, model: null, error: INSIGHTS_QUOTA_ERROR };
    }
    if (result.status === 'failed') {
      this.logger.warn(`Insights AI call failed: ${result.error}`);
      return { status: 'failed', content: null, tokens: 0, model: null, error: INSIGHTS_FAILED_ERROR };
    }
    const content = parseInsightsContent(result.json, refs);
    return {
      status: content ? 'ready' : 'failed',
      content,
      tokens: result.tokens.total,
      model: result.model,
      error: content ? null : INSIGHTS_INVALID_ERROR,
    };
  }

  private async notify(storeId: number, summary: WorkflowInsightsSummary): Promise<void> {
    try {
      await this.notifications.createAndBroadcast(
        storeId,
        'workflow_task',
        INSIGHTS_NOTIFICATION_TITLE,
        summary.content?.headline ?? '',
        { kind: 'workflow_insights', summary_id: summary.id, url: INSIGHTS_URL },
      );
    } catch (e) {
      this.logger.warn(`Weekly insights notification of store ${storeId} failed: ${(e as Error)?.message}`);
    }
  }

  /** The cooldown counts only summaries that came out: a failed try does not make the owner wait. */
  private lastManual(storeId: number): Promise<{ created_at: Date } | null> {
    return this.prisma.workflow_ai_summaries.findFirst({
      where: { store_id: storeId, kind: 'manual', status: 'ready' },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    }) as Promise<{ created_at: Date } | null>;
  }

  private storeId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    return storeId;
  }
}

function flowInput(key: string, name: string, report: WorkflowAnalyticsReport): WorkflowInsightsFlowInput {
  const { kpis } = report;
  const slowest = report.stages.find((s) => s.stage_key === report.bottleneck_stage_key) ?? null;
  return {
    key,
    name,
    started: kpis.started,
    completed: kpis.completed,
    open: kpis.active,
    completion_rate_percent: kpis.started > 0 ? percent(kpis.completed / kpis.started) : null,
    avg_cycle_hours: kpis.cycle_avg_hours,
    p90_cycle_hours: kpis.cycle_p90_hours,
    overdue_share_percent: kpis.active > 0 ? percent(kpis.overdue / kpis.active) : null,
    slowest_stage: slowest ? { name: slowest.name, open_tasks: slowest.wip } : null,
    insufficient_data: report.insufficient_data,
  };
}

/** The store over the period, across every flow with activity (narrated or not). */
export function storeTotals(flows: WorkflowInsightsFlowInput[]): WorkflowInsightsTotals {
  const active = flows.filter((f) => f.started + f.completed + f.open > 0);
  const sum = (pick: (f: WorkflowInsightsFlowInput) => number) => active.reduce((acc, f) => acc + pick(f), 0);
  const started = sum((f) => f.started);
  const completed = sum((f) => f.completed);
  return {
    active_flows: active.length,
    started,
    completed,
    open: sum((f) => f.open),
    completion_rate_percent: started > 0 ? percent(completed / started) : null,
  };
}

/**
 * The flows the AI narrates: those with activity in the window, the busiest
 * first (started + completed + open), at most INSIGHTS_LIMITS.flows.
 */
export function flowsToNarrate(flows: WorkflowInsightsFlowInput[]): WorkflowInsightsFlowInput[] {
  return flows
    .map((flow, index) => ({ flow, index, load: flow.started + flow.completed + flow.open }))
    .filter((f) => f.load > 0)
    .sort((a, b) => b.load - a.load || a.index - b.index)
    .slice(0, INSIGHTS_LIMITS.flows)
    .map((f) => f.flow);
}

function percent(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

function cooldownEnd(lastManual: { created_at: Date } | null, now: Date): Date | null {
  if (!lastManual) return null;
  const end = new Date(new Date(lastManual.created_at).getTime() + INSIGHTS_MANUAL_COOLDOWN_MS);
  return end.getTime() > now.getTime() ? end : null;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * A summary as the API returns it. `hidden` are the flows the reader may not
 * see: their part is dropped (summaries written before a flow was restricted).
 */
function present(row: SummaryRow, hidden: ReadonlySet<number> = new Set()): WorkflowInsightsSummary {
  const content = (row.content as WorkflowInsightsContent | null) ?? null;
  return {
    id: row.id,
    kind: row.kind as WorkflowInsightsKind,
    status: row.status as WorkflowInsightsStatus,
    period_from: dateOnlyString(row.period_from),
    period_to: dateOnlyString(row.period_to),
    week_key: row.week_key,
    content:
      content && hidden.size && Array.isArray(content.flows)
        ? { ...content, flows: content.flows.filter((f) => !hidden.has(f.definition_id)) }
        : content,
    tokens_used: row.tokens_used,
    model: row.model,
    error: row.error,
    created_at: new Date(row.created_at).toISOString(),
  };
}
