import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAiQuota, WorkflowAiService } from '../ai/workflow-ai.service';
import { WORKFLOW_USAGE_WARNING_PERCENT } from './workflow-limits.constants';
import { WorkflowLimitsService, workflowPeriod } from './workflow-limits.service';

export type WorkflowUsageMetricKey =
  | 'monthly_instances'
  | 'monthly_http_calls'
  | 'storage_bytes'
  | 'monthly_ai_tokens';

/**
 * `ok` < 80 %, `warning` from 80 %, `blocked` at 100 %, `unlimited` when the
 * plan sets no cap, `unavailable` when the plan does not include the feature.
 */
export type WorkflowUsageState = 'ok' | 'warning' | 'blocked' | 'unlimited' | 'unavailable';

export interface WorkflowUsageMetric {
  key: WorkflowUsageMetricKey;
  used: number;
  /** `null` = unlimited or unavailable. */
  cap: number | null;
  /** 0-100, `null` when there is no cap. */
  percent: number | null;
  state: WorkflowUsageState;
}

export interface WorkflowUsageSnapshot {
  /** Current UTC month, `YYYY-MM`. */
  period: string;
  metrics: WorkflowUsageMetric[];
}

function meter(key: WorkflowUsageMetricKey, used: number, cap: number | null): WorkflowUsageMetric {
  if (cap === null) return { key, used, cap, percent: null, state: 'unlimited' };
  const percent = cap <= 0 ? 100 : Math.min(100, Math.floor((used / cap) * 100));
  const state = percent >= 100 ? 'blocked' : percent >= WORKFLOW_USAGE_WARNING_PERCENT ? 'warning' : 'ok';
  return { key, used, cap, percent, state };
}

/** The AI quota of the plan (D4: its figures are never changed here) as a meter. */
function tokensMeter(quota: WorkflowAiQuota): WorkflowUsageMetric {
  const key = 'monthly_ai_tokens' as const;
  if (quota.state === 'unavailable') return { key, used: quota.used, cap: null, percent: null, state: 'unavailable' };
  if (quota.cap === null) return { key, used: quota.used, cap: null, percent: null, state: 'unlimited' };
  return {
    key,
    used: quota.used,
    cap: quota.cap,
    percent: Math.min(100, quota.percent ?? 0),
    state: quota.state,
  };
}

/** What the "Uso del plan" screen shows: the four meters of Flows for this month. */
@Injectable()
export class WorkflowUsageService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly limits: WorkflowLimitsService,
    private readonly ai: WorkflowAiService,
  ) {}

  async snapshot(): Promise<WorkflowUsageSnapshot> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    const period = workflowPeriod();
    const [caps, instances, httpCalls, storage, quota] = await Promise.all([
      this.limits.effectiveLimits(storeId),
      this.limits.counterValue(this.prisma, storeId, period, 'monthly_instances'),
      this.limits.counterValue(this.prisma, storeId, period, 'monthly_http_calls'),
      this.limits.storageUsed(storeId),
      this.ai.quota(),
    ]);
    return {
      period,
      metrics: [
        meter('monthly_instances', instances, caps.monthly_instances),
        meter('monthly_http_calls', httpCalls, caps.monthly_http_calls),
        meter('storage_bytes', storage, caps.storage_bytes),
        tokensMeter(quota),
      ],
    };
  }
}
