import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

/** Below this many finished instances in the window, p90 means nothing. */
export const INSUFFICIENT_DATA_THRESHOLD = 20;
/** Bounds of the TypeScript pass (a window never loads more than this). */
export const MAX_WINDOW_INSTANCES = 5000;
export const MAX_ACTIVE_INSTANCES = 10000;
export const MAX_WINDOW_EVENTS = 200000;

const HOUR_MS = 3_600_000;
const FINISHED = ['completed', 'rejected'];

export interface StageMetricsRange {
  from: Date;
  to: Date;
}

export interface StageMetric {
  stage_key: string;
  name: string;
  /** Active instances sitting in the stage right now. */
  wip: number;
  /** Entries to the stage inside the window. */
  entered: number;
  /** Exits (with a measured duration) inside the window. */
  exited: number;
  avg_hours: number | null;
  p90_hours: number | null;
  /** Active instances in the stage whose `stage_due_at` already passed. */
  overdue_now: number;
}

export interface StageMetricsResult {
  definition_id: number;
  from: Date;
  to: Date;
  /** Instances that reached an end stage (completed or rejected) in the window. */
  completed_instances: number;
  insufficient_data: boolean;
  stages: StageMetric[];
  /** max(p90_hours x wip) among stages with at least one exit; null when unknown. */
  bottleneck_stage_key: string | null;
  truncated: boolean;
}

interface EventRow {
  instance_id: number;
  seq: number;
  from_stage_key: string | null;
  to_stage_key: string | null;
  occurred_at: Date;
}

/** Nearest-rank percentile (`p` in 0..1): the value at rank ceil(p * n). */
export function nearestRank(
  values: readonly number[],
  p: number,
): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Deterministic stage metrics from `workflow_instance_events` (§6.6 / §7 of the
 * design). The numbers the AI narrates come from here, never from the model.
 *
 * Choice: TypeScript over a BOUNDED query instead of `$queryRaw`. Pairing the
 * entry and the exit of each visit (loops included) is a per-instance fold;
 * the inputs are bounded (`MAX_*`), every query carries an explicit
 * `store_id`/`definition_id` predicate, and the logic is unit-testable without
 * a database. Durations: a stage is entered at the event whose
 * `to_stage_key` is the stage and exited at the next event of that instance
 * whose `from_stage_key` is the stage. Absolute instants, so the store
 * timezone does not change any figure (it only matters when rendering dates).
 */
@Injectable()
export class WorkflowMetricsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private storeId(): number {
    const id = RequestContextService.getContext()?.store_id;
    if (!id)
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    return id;
  }

  async stageMetrics(
    definitionId: number,
    range: StageMetricsRange,
  ): Promise<StageMetricsResult> {
    const store_id = this.storeId();
    const { from, to } = range;

    const definitionRow = await this.prisma.workflow_definitions.findFirst({
      where: { id: definitionId, store_id },
      select: { id: true, draft_definition: true },
    });
    if (!definitionRow) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    const latest = await this.prisma.workflow_versions.findFirst({
      where: { store_id, definition_id: definitionId },
      orderBy: { version: 'desc' },
      select: { definition: true },
    });
    const definition = (latest?.definition ??
      definitionRow.draft_definition) as WorkflowDefinitionV1 | null;
    const stageDefs = (definition?.stages ?? []).filter(
      (s) => s.type !== 'end',
    );

    const [active, completed, windowInstances] = await Promise.all([
      this.prisma.workflow_instances.findMany({
        where: { store_id, definition_id: definitionId, status: 'active' },
        select: { id: true, current_stage_key: true, stage_due_at: true },
        take: MAX_ACTIVE_INSTANCES,
      }),
      this.prisma.workflow_instances.count({
        where: {
          store_id,
          definition_id: definitionId,
          status: { in: FINISHED },
          completed_at: { gte: from, lte: to },
        },
      }),
      this.prisma.workflow_instances.findMany({
        where: {
          store_id,
          definition_id: definitionId,
          created_at: { lte: to },
          OR: [{ completed_at: null }, { completed_at: { gte: from } }],
        },
        select: { id: true },
        orderBy: { id: 'desc' },
        take: MAX_WINDOW_INSTANCES,
      }),
    ]);

    const events: EventRow[] = windowInstances.length
      ? await this.prisma.workflow_instance_events.findMany({
          where: {
            store_id,
            instance_id: {
              in: windowInstances.map((i: { id: number }) => i.id),
            },
            occurred_at: { lte: to },
          },
          select: {
            instance_id: true,
            seq: true,
            from_stage_key: true,
            to_stage_key: true,
            occurred_at: true,
          },
          orderBy: [{ instance_id: 'asc' }, { seq: 'asc' }],
          take: MAX_WINDOW_EVENTS,
        })
      : [];

    const entered = new Map<string, number>();
    const durations = new Map<string, number[]>();
    const open = new Map<number, Map<string, number>>();
    const inWindow = (t: number) => t >= from.getTime() && t <= to.getTime();
    for (const e of events) {
      const t = new Date(e.occurred_at).getTime();
      let visits = open.get(e.instance_id);
      if (!visits) {
        visits = new Map();
        open.set(e.instance_id, visits);
      }
      if (e.from_stage_key && visits.has(e.from_stage_key)) {
        const started = visits.get(e.from_stage_key)!;
        visits.delete(e.from_stage_key);
        if (inWindow(t)) {
          const list = durations.get(e.from_stage_key) ?? [];
          list.push((t - started) / HOUR_MS);
          durations.set(e.from_stage_key, list);
        }
      }
      if (e.to_stage_key) {
        visits.set(e.to_stage_key, t);
        if (inWindow(t)) {
          entered.set(e.to_stage_key, (entered.get(e.to_stage_key) ?? 0) + 1);
        }
      }
    }

    const now = Date.now();
    const wip = new Map<string, number>();
    const overdue = new Map<string, number>();
    for (const row of active as Array<{
      current_stage_key: string;
      stage_due_at: Date | null;
    }>) {
      wip.set(row.current_stage_key, (wip.get(row.current_stage_key) ?? 0) + 1);
      if (row.stage_due_at && new Date(row.stage_due_at).getTime() < now) {
        overdue.set(
          row.current_stage_key,
          (overdue.get(row.current_stage_key) ?? 0) + 1,
        );
      }
    }

    const stages: StageMetric[] = stageDefs.map((s) => {
      const list = durations.get(s.key) ?? [];
      const p90 = nearestRank(list, 0.9);
      return {
        stage_key: s.key,
        name: s.name,
        wip: wip.get(s.key) ?? 0,
        entered: entered.get(s.key) ?? 0,
        exited: list.length,
        avg_hours: list.length
          ? round2(list.reduce((a, b) => a + b, 0) / list.length)
          : null,
        p90_hours: p90 === null ? null : round2(p90),
        overdue_now: overdue.get(s.key) ?? 0,
      };
    });

    const insufficient_data = completed < INSUFFICIENT_DATA_THRESHOLD;
    let bottleneck: string | null = null;
    if (!insufficient_data) {
      let best = 0;
      for (const s of stages) {
        if (s.exited < 1 || s.p90_hours === null) continue;
        const score = s.p90_hours * s.wip;
        if (score > best) {
          best = score;
          bottleneck = s.stage_key;
        }
      }
    }

    return {
      definition_id: definitionId,
      from,
      to,
      completed_instances: completed,
      insufficient_data,
      stages,
      bottleneck_stage_key: bottleneck,
      truncated:
        windowInstances.length >= MAX_WINDOW_INSTANCES ||
        active.length >= MAX_ACTIVE_INSTANCES ||
        events.length >= MAX_WINDOW_EVENTS,
    };
  }
}
