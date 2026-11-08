import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  WORKFLOW_AI_PURPOSES,
  WorkflowAiPurpose,
  WorkflowAiQuota,
  WorkflowAiService,
} from './workflow-ai.service';

export const NO_FLOW_LABEL = 'Sin flujo';
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** The current month plus the 11 before it. */
const MONTHS_BACK = 11;

export interface WorkflowAiUsageByFlow {
  definition_id: number | null;
  name: string;
  calls: number;
  tokens: number;
}

export interface WorkflowAiUsageByPurpose {
  purpose: WorkflowAiPurpose;
  calls: number;
  tokens: number;
}

export interface WorkflowAiUsageReport {
  month: string;
  /** Plan quota; only for the current month. */
  quota: WorkflowAiQuota | null;
  flows_tokens: number;
  calls: number;
  skipped: number;
  by_flow: WorkflowAiUsageByFlow[];
  by_purpose: WorkflowAiUsageByPurpose[];
}

interface UsageGroup {
  definition_id: number | null;
  purpose: string;
  status: string;
  _count: { _all: number };
  _sum: { total_tokens: number | null };
}

/**
 * P6.3: what the AI calls of Flows spent in one UTC month (the same period as
 * the plan counter), by flow and by purpose. Calls are the ones that reached
 * the provider (success or failed); `skipped_quota` rows are counted apart and
 * never spent tokens.
 */
@Injectable()
export class WorkflowAiUsageService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly ai: WorkflowAiService,
  ) {}

  async report(month?: string, now = new Date()): Promise<WorkflowAiUsageReport> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    const current = monthKey(now);
    const selected = month ?? current;
    const { from, to } = monthBounds(selected, now);

    const groups = (await this.prisma.workflow_ai_usage.groupBy({
      by: ['definition_id', 'purpose', 'status'],
      where: { store_id: storeId, created_at: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { total_tokens: true },
    })) as UsageGroup[];

    const flows = new Map<number | null, { calls: number; tokens: number }>();
    const purposes = new Map<string, { calls: number; tokens: number }>(
      WORKFLOW_AI_PURPOSES.map((p) => [p, { calls: 0, tokens: 0 }]),
    );
    let flowsTokens = 0;
    let calls = 0;
    let skipped = 0;
    for (const g of groups) {
      const tokens = g._sum.total_tokens ?? 0;
      const n = g._count._all;
      flowsTokens += tokens;
      const spent = g.status === 'skipped_quota' ? 0 : n;
      if (g.status === 'skipped_quota') skipped += n;
      calls += spent;
      const flow = flows.get(g.definition_id) ?? { calls: 0, tokens: 0 };
      flow.calls += spent;
      flow.tokens += tokens;
      flows.set(g.definition_id, flow);
      const purpose = purposes.get(g.purpose);
      if (purpose) {
        purpose.calls += spent;
        purpose.tokens += tokens;
      }
    }

    const names = await this.flowNames([...flows.keys()].filter((id): id is number => id !== null), storeId);
    const by_flow = [...flows.entries()]
      .map(([definition_id, v]) => ({
        definition_id,
        name: definition_id === null ? NO_FLOW_LABEL : (names.get(definition_id) ?? NO_FLOW_LABEL),
        calls: v.calls,
        tokens: v.tokens,
      }))
      .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls);

    return {
      month: selected,
      quota: selected === current ? await this.ai.quota() : null,
      flows_tokens: flowsTokens,
      calls,
      skipped,
      by_flow,
      by_purpose: WORKFLOW_AI_PURPOSES.map((purpose) => ({ purpose, ...purposes.get(purpose)! })),
    };
  }

  private async flowNames(ids: number[], storeId: number): Promise<Map<number, string>> {
    if (!ids.length) return new Map();
    const rows = (await this.prisma.workflow_definitions.findMany({
      where: { id: { in: ids }, store_id: storeId },
      select: { id: true, name: true },
    })) as Array<{ id: number; name: string }>;
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** UTC bounds `[from, to)` of a valid month within the last 12; throws otherwise. */
function monthBounds(month: string, now: Date): { from: Date; to: Date } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new VendixHttpException(ErrorCodes.WORKFLOW_AI_USAGE_MONTH_INVALID);
  const year = Number(m[1]);
  const index = Number(m[2]) - 1;
  const monthsAgo = (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() - index);
  if (monthsAgo < 0 || monthsAgo > MONTHS_BACK) {
    throw new VendixHttpException(ErrorCodes.WORKFLOW_AI_USAGE_MONTH_INVALID);
  }
  return { from: new Date(Date.UTC(year, index, 1)), to: new Date(Date.UTC(year, index + 1, 1)) };
}
