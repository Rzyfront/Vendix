import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  daysBetweenDateStrings,
  localDateString,
  resolveLocalDateRange,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  MAX_WINDOW_INSTANCES,
  WorkflowMetricsService,
  nearestRank,
} from './workflow-metrics.service';

export const ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 30;
const MAX_WINDOW_TASKS = 50000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface WorkflowAnalyticsKpis {
  started: number;
  completed: number;
  rejected: number;
  cancelled: number;
  /** Instances in progress right now (not only those started in the window). */
  active: number;
  /** Active instances whose stage deadline already passed. */
  overdue: number;
  cycle_avg_hours: number | null;
  cycle_p90_hours: number | null;
  /** 0..1; null when no done task in the window had a deadline. */
  on_time_rate: number | null;
}

export interface WorkflowAnalyticsStage {
  stage_key: string;
  name: string;
  wip: number;
  entered: number;
  exited: number;
  avg_hours: number | null;
  p90_hours: number | null;
  overdue_now: number;
  on_time_rate: number | null;
  reject_rate: number | null;
}

export interface WorkflowAnalyticsPerson {
  user_id: number;
  name: string;
  tasks_done: number;
  on_time_rate: number | null;
  avg_hours: number | null;
}

export interface WorkflowAnalyticsDay {
  /** Store business day, `YYYY-MM-DD`. */
  date: string;
  started: number;
  completed: number;
}

/** The ONE dataset the screen renders and the XLSX is built from. */
export interface WorkflowAnalyticsReport {
  definition: { id: number; name: string };
  range: { from: string; to: string; timezone: string };
  kpis: WorkflowAnalyticsKpis;
  stages: WorkflowAnalyticsStage[];
  people: WorkflowAnalyticsPerson[];
  bottleneck_stage_key: string | null;
  insufficient_data: boolean;
  daily: WorkflowAnalyticsDay[];
  /** A bounded query hit its cap: figures may be partial. */
  truncated: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const rate = (num: number, den: number) => (den > 0 ? round2(num / den) : null);
const mean = (xs: number[]) =>
  xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

interface InstanceRow {
  id: number;
  status: string;
  created_at: Date;
  completed_at: Date | null;
}

interface TaskRow {
  stage_key: string;
  outcome: string | null;
  due_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
  completed_by_user_id: number | null;
}

/**
 * KPIs of one flow (block 12). A single entry point, {@link report}, feeds the
 * screen (JSON) and the XLSX, so both always show the same numbers. Stage
 * figures reuse {@link WorkflowMetricsService.stageMetrics} (the same source
 * the AI bottleneck tool uses). `from`/`to` are store-local calendar dates
 * converted with the store timezone; days are store business days.
 */
@Injectable()
export class WorkflowAnalyticsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly metrics: WorkflowMetricsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private storeId(): number {
    const id = RequestContextService.getContext()?.store_id;
    if (!id)
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    return id;
  }

  async report(
    definitionId: number,
    query: { from?: string; to?: string } = {},
  ): Promise<WorkflowAnalyticsReport> {
    const store_id = this.storeId();
    const timezone = await resolveStoreTimezone(this.prisma, store_id);

    const to = query.to ?? localDateString(new Date(), timezone);
    const from = query.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Las fechas deben tener el formato AAAA-MM-DD.',
      );
    }
    const span = daysBetweenDateStrings(from, to) + 1;
    if (span < 1 || span > MAX_RANGE_DAYS) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `El rango debe ir de 1 a ${MAX_RANGE_DAYS} días y "desde" no puede ser posterior a "hasta".`,
      );
    }

    const cacheKey = `workflows:analytics:v1:${store_id}:${definitionId}:${from}:${to}`;
    const cached = await this.cache.get<WorkflowAnalyticsReport>(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = resolveLocalDateRange(
      { date_from: from, date_to: to },
      timezone,
    );

    // Throws WORKFLOW_DEFINITION_NOT_FOUND when the flow is not this store's.
    const stageResult = await this.metrics.stageMetrics(definitionId, {
      from: startDate,
      to: endDate,
    });
    const definition = await this.prisma.workflow_definitions.findFirst({
      where: { id: definitionId, store_id },
      select: { id: true, name: true },
    });

    const inRange = (d: Date | null | undefined) =>
      !!d &&
      d.getTime() >= startDate.getTime() &&
      d.getTime() <= endDate.getTime();

    const [instances, tasks] = await Promise.all([
      this.prisma.workflow_instances.findMany({
        where: {
          store_id,
          definition_id: definitionId,
          OR: [
            { created_at: { gte: startDate, lte: endDate } },
            { completed_at: { gte: startDate, lte: endDate } },
          ],
        },
        select: {
          id: true,
          status: true,
          created_at: true,
          completed_at: true,
        },
        orderBy: { id: 'desc' },
        take: MAX_WINDOW_INSTANCES,
      }) as Promise<InstanceRow[]>,
      this.prisma.workflow_tasks.findMany({
        where: {
          store_id,
          status: 'done',
          completed_at: { gte: startDate, lte: endDate },
          instance: { definition_id: definitionId },
        },
        select: {
          stage_key: true,
          outcome: true,
          due_at: true,
          created_at: true,
          completed_at: true,
          completed_by_user_id: true,
        },
        orderBy: { id: 'desc' },
        take: MAX_WINDOW_TASKS,
      }) as Promise<TaskRow[]>,
    ]);

    // --- instances: KPIs + daily series (store business day) ---
    const dailyMap = new Map<string, WorkflowAnalyticsDay>();
    for (let i = 0; i < span; i++) {
      const date = addDays(from, i);
      dailyMap.set(date, { date, started: 0, completed: 0 });
    }
    let started = 0;
    let completed = 0;
    let rejected = 0;
    let cancelled = 0;
    const cycles: number[] = [];
    for (const row of instances) {
      const createdAt = new Date(row.created_at);
      const doneAt = row.completed_at ? new Date(row.completed_at) : null;
      if (inRange(createdAt)) {
        started++;
        const day = dailyMap.get(localDateString(createdAt, timezone));
        if (day) day.started++;
      }
      if (doneAt && inRange(doneAt)) {
        if (row.status === 'completed') {
          completed++;
          cycles.push((doneAt.getTime() - createdAt.getTime()) / HOUR_MS);
          const day = dailyMap.get(localDateString(doneAt, timezone));
          if (day) day.completed++;
        } else if (row.status === 'rejected') rejected++;
        else if (row.status === 'cancelled') cancelled++;
      }
    }
    const cycleP90 = nearestRank(cycles, 0.9);

    // --- tasks: on-time and reject rates by stage and by person ---
    interface Acc {
      done: number;
      withDue: number;
      onTime: number;
      decisions: number;
      rejects: number;
      hours: number[];
    }
    const newAcc = (): Acc => ({
      done: 0,
      withDue: 0,
      onTime: 0,
      decisions: 0,
      rejects: 0,
      hours: [],
    });
    const byStage = new Map<string, Acc>();
    const byUser = new Map<number, Acc>();
    const total = newAcc();
    const add = (acc: Acc, t: TaskRow, doneAt: Date) => {
      acc.done++;
      if (t.due_at) {
        acc.withDue++;
        if (doneAt.getTime() <= new Date(t.due_at).getTime()) acc.onTime++;
      }
      if (t.outcome) {
        acc.decisions++;
        if (t.outcome === 'reject') acc.rejects++;
      }
      acc.hours.push(
        (doneAt.getTime() - new Date(t.created_at).getTime()) / HOUR_MS,
      );
    };
    for (const t of tasks) {
      if (!t.completed_at) continue;
      const doneAt = new Date(t.completed_at);
      add(total, t, doneAt);
      const s = byStage.get(t.stage_key) ?? newAcc();
      add(s, t, doneAt);
      byStage.set(t.stage_key, s);
      if (t.completed_by_user_id) {
        const u = byUser.get(t.completed_by_user_id) ?? newAcc();
        add(u, t, doneAt);
        byUser.set(t.completed_by_user_id, u);
      }
    }

    const stages: WorkflowAnalyticsStage[] = stageResult.stages.map((s) => {
      const acc = byStage.get(s.stage_key);
      return {
        stage_key: s.stage_key,
        name: s.name,
        wip: s.wip,
        entered: s.entered,
        exited: s.exited,
        avg_hours: s.avg_hours,
        p90_hours: s.p90_hours,
        overdue_now: s.overdue_now,
        on_time_rate: acc ? rate(acc.onTime, acc.withDue) : null,
        reject_rate: acc ? rate(acc.rejects, acc.decisions) : null,
      };
    });

    const userIds = [...byUser.keys()];
    const users = userIds.length
      ? ((await this.prisma.withoutScope().users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, first_name: true, last_name: true },
        })) as Array<{
          id: number;
          first_name: string | null;
          last_name: string | null;
        }>)
      : [];
    const nameOf = new Map(
      users.map((u) => [
        u.id,
        [u.first_name, u.last_name].filter(Boolean).join(' ').trim(),
      ]),
    );
    const people: WorkflowAnalyticsPerson[] = [...byUser.entries()]
      .map(([user_id, acc]) => ({
        user_id,
        name: nameOf.get(user_id) || `Usuario ${user_id}`,
        tasks_done: acc.done,
        on_time_rate: rate(acc.onTime, acc.withDue),
        avg_hours: mean(acc.hours),
      }))
      .sort((a, b) => b.tasks_done - a.tasks_done || a.user_id - b.user_id);

    const result: WorkflowAnalyticsReport = {
      definition: {
        id: definitionId,
        name: definition?.name ?? String(definitionId),
      },
      range: { from, to, timezone },
      kpis: {
        started,
        completed,
        rejected,
        cancelled,
        active: stageResult.stages.reduce((n, s) => n + s.wip, 0),
        overdue: stageResult.stages.reduce((n, s) => n + s.overdue_now, 0),
        cycle_avg_hours: mean(cycles),
        cycle_p90_hours: cycleP90 === null ? null : round2(cycleP90),
        on_time_rate: rate(total.onTime, total.withDue),
      },
      stages,
      people,
      bottleneck_stage_key: stageResult.bottleneck_stage_key,
      insufficient_data: stageResult.insufficient_data,
      daily: [...dailyMap.values()],
      truncated:
        stageResult.truncated ||
        instances.length >= MAX_WINDOW_INSTANCES ||
        tasks.length >= MAX_WINDOW_TASKS,
    };
    await this.cache.set(cacheKey, result, ANALYTICS_CACHE_TTL_MS);
    return result;
  }
}
