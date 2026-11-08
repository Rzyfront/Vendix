/** Contract of `store/workflows/ai-usage` and `store/workflows/insights/*` (P6). */

export type WorkflowAiQuotaState = 'ok' | 'warning' | 'blocked' | 'unavailable';

export type WorkflowAiPurpose =
  | 'ai_step'
  | 'ai_step_test'
  | 'document_read'
  | 'insights_summary';

export interface WorkflowAiQuota {
  state: WorkflowAiQuotaState;
  used: number;
  cap: number | null;
  percent: number | null;
  period: string;
  reason: string | null;
}

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

export interface WorkflowAiUsage {
  month: string;
  /** Plan quota; only present for the current month. */
  quota: WorkflowAiQuota | null;
  flows_tokens: number;
  calls: number;
  skipped: number;
  by_flow: WorkflowAiUsageByFlow[];
  by_purpose: WorkflowAiUsageByPurpose[];
}

export type WorkflowSummaryKind = 'weekly' | 'manual';
export type WorkflowSummaryStatus = 'ready' | 'failed' | 'skipped_quota';

export interface WorkflowSummaryFlow {
  key: string;
  definition_id: number | null;
  name: string;
  text: string;
}

export interface WorkflowSummaryContent {
  headline: string;
  summary: string;
  flows: WorkflowSummaryFlow[];
  recommendations: string[];
}

export interface WorkflowSummary {
  id: number;
  kind: WorkflowSummaryKind;
  status: WorkflowSummaryStatus;
  /** Calendar dates `YYYY-MM-DD` in the store's business days. */
  period_from: string;
  period_to: string;
  week_key: string | null;
  content: WorkflowSummaryContent | null;
  tokens_used: number;
  model: string | null;
  error: string | null;
  created_at: string;
}

export interface WorkflowSummariesList {
  items: WorkflowSummary[];
  can_generate: boolean;
  next_generate_at: string | null;
}
