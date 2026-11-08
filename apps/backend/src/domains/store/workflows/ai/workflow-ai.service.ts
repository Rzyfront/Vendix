import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { AIMessage, AIResponse } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { parseAiJson } from '../../../../ai-engine/utils/ai-json.util';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException } from '../../../../common/errors';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SubscriptionAccessService } from '../../subscriptions/services/subscription-access.service';

/** Keep in sync with `prisma/seeds/workflow-ai-step.application.ts`. */
export const WORKFLOW_AI_STEP_APP_KEY = 'workflow_ai_step';
/** Keep in sync with `prisma/seeds/workflow-insights-summary.application.ts`. */
export const WORKFLOW_INSIGHTS_APP_KEY = 'workflow_insights_summary';

export const WORKFLOW_AI_PURPOSES = ['ai_step', 'ai_step_test', 'document_read', 'insights_summary'] as const;
export type WorkflowAiPurpose = (typeof WORKFLOW_AI_PURPOSES)[number];

export type WorkflowAiUsageStatus = 'success' | 'failed' | 'skipped_quota';

/** Share of the plan quota (D4: the plan figures never change here). */
export const WORKFLOW_AI_WARNING_PERCENT = 80;
export const WORKFLOW_AI_BLOCK_PERCENT = 100;

export const WORKFLOW_AI_WARNING_TITLE = 'Tus flujos llevan el 80 % del cupo de IA del plan';
export const WORKFLOW_AI_BLOCK_TITLE =
  'Cupo de IA agotado: los pasos de IA pasan a revisión manual hasta el próximo mes';

/** The plan quota that Flows spends: tokens of `text_generation`. */
const QUOTA_FEATURE = 'text_generation' as const;
const ALERT_TTL_SECONDS = 40 * 24 * 60 * 60;
const INSIGHTS_URL = '/admin/workflows/insights';

/**
 * `ok`/`warning`: AI runs. `blocked`: the monthly tokens are used up, Flows
 * stops calling the AI (soft block) and the flow follows its manual path.
 * `unavailable`: the plan does not include AI text generation or the
 * subscription blocks it.
 */
export type WorkflowAiQuotaState = 'ok' | 'warning' | 'blocked' | 'unavailable';

export interface WorkflowAiQuota {
  state: WorkflowAiQuotaState;
  used: number;
  /** Null when the plan has no monthly token cap. */
  cap: number | null;
  /** Rounded down; null without a cap. */
  percent: number | null;
  /** UTC month of the plan counter, `YYYY-MM`. */
  period: string;
  /** Subscription reason when the state is `blocked` or `unavailable`. */
  reason: string | null;
}

export interface WorkflowAiTokens {
  prompt: number;
  completion: number;
  total: number;
}

export interface WorkflowAiRunInput {
  appKey: string;
  purpose: WorkflowAiPurpose;
  messages: AIMessage[];
  variables?: Record<string, string>;
  definitionId?: number | null;
  instanceId?: number | null;
  stageKey?: string | null;
}

export type WorkflowAiRunResult =
  | {
      status: 'success';
      content: string;
      /** Parsed JSON object of the answer, or null when it is not JSON. */
      json: unknown;
      model: string | null;
      tokens: WorkflowAiTokens;
    }
  | { status: 'skipped_quota'; quota: WorkflowAiQuota }
  | { status: 'failed'; error: string; code: string | null; retryable: boolean };

export interface WorkflowAiUsageInput {
  purpose: WorkflowAiPurpose;
  status: WorkflowAiUsageStatus;
  appKey?: string | null;
  model?: string | null;
  tokens?: Partial<WorkflowAiTokens> | null;
  definitionId?: number | null;
  instanceId?: number | null;
  stageKey?: string | null;
}

/** What a ledger row is attributed to, before its status is known. */
export type WorkflowAiUsageRef = Omit<WorkflowAiUsageInput, 'status'>;

/** Errors of configuration or permission: retrying the same call cannot help. */
const NON_RETRYABLE_CODES = new Set(['SUBSCRIPTION_005', 'AI_APP_001', 'AI_APP_003', 'AI_CONFIG_001', 'AI_PROVIDER_002']);

/**
 * Single gateway for every AI call made by Flows (flujos-adm P6.3): the AI
 * step, its test, the document read and the weekly summary. It checks the
 * plan quota first (soft block at 100 %), calls `AIEngineService.run` (which
 * still owns the plan gate and the quota counter), records one
 * `workflow_ai_usage` row per call and warns the owners once per month at
 * 80 % and at 100 %.
 */
@Injectable()
export class WorkflowAiService {
  private readonly logger = new Logger(WorkflowAiService.name);

  constructor(
    private readonly ai: AIEngineService,
    private readonly prisma: StorePrismaService,
    private readonly access: SubscriptionAccessService,
    private readonly notifications: NotificationsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async quota(): Promise<WorkflowAiQuota> {
    const storeId = this.storeId();
    const period = currentPeriod();
    const [check, snapshot] = await Promise.all([
      this.access.canUseAIFeature(storeId, QUOTA_FEATURE),
      this.access.getAIUsageSnapshot(storeId),
    ]);
    const entry = snapshot[QUOTA_FEATURE];
    const used = entry?.used ?? 0;
    const cap = entry?.cap ?? null;
    const percent = cap ? Math.floor((used / cap) * 100) : null;
    if (!check.allowed) {
      const exhausted = check.reason === 'SUBSCRIPTION_006';
      return { state: exhausted ? 'blocked' : 'unavailable', used, cap, percent, period, reason: check.reason ?? null };
    }
    return { state: stateOf(percent), used, cap, percent, period, reason: null };
  }

  async run(input: WorkflowAiRunInput): Promise<WorkflowAiRunResult> {
    const quota = await this.quota();
    if (quota.state === 'blocked') return this.skipped(usageRef(input), quota);

    let response: AIResponse;
    try {
      response = await this.ai.run(input.appKey, input.variables ?? {}, input.messages);
    } catch (e) {
      const code = e instanceof VendixHttpException ? e.errorCode : null;
      if (code === 'SUBSCRIPTION_006') {
        return this.skipped(usageRef(input), { ...quota, state: 'blocked', reason: code });
      }
      await this.recordUsage({ ...usageRef(input), status: 'failed' });
      return {
        status: 'failed',
        error: (e as Error)?.message ?? 'AI call failed',
        code,
        retryable: code === null || !NON_RETRYABLE_CODES.has(code),
      };
    }

    const tokens = tokensOf(response);
    if (!response.success || !response.content) {
      await this.recordUsage({ ...usageRef(input), status: 'failed', model: response.model ?? null, tokens });
      return {
        status: 'failed',
        error: response.error ?? 'Empty AI response',
        code: response.error_code ?? null,
        retryable: response.retryable ?? true,
      };
    }

    await this.recordUsage({ ...usageRef(input), status: 'success', model: response.model ?? null, tokens });
    await this.warnAfterSpend(quota, tokens.total);
    return {
      status: 'success',
      content: response.content,
      json: parseJson(response.content),
      model: response.model ?? null,
      tokens,
    };
  }

  /**
   * Writes one ledger row. Never throws: losing the attribution of one call is
   * better than failing the flow step that already spent the tokens.
   */
  async recordUsage(input: WorkflowAiUsageInput): Promise<void> {
    try {
      await this.prisma.workflow_ai_usage.create({
        data: {
          store_id: this.storeId(),
          definition_id: input.definitionId ?? null,
          instance_id: input.instanceId ?? null,
          stage_key: input.stageKey ?? null,
          purpose: input.purpose,
          app_key: input.appKey ?? null,
          model: input.model ? input.model.slice(0, 100) : null,
          prompt_tokens: input.tokens?.prompt ?? 0,
          completion_tokens: input.tokens?.completion ?? 0,
          total_tokens: input.tokens?.total ?? 0,
          status: input.status,
        },
      });
    } catch (e) {
      this.logger.warn(`AI usage of ${input.purpose} not recorded: ${(e as Error)?.message}`);
    }
  }

  /**
   * Re-reads the plan counter after a call made outside `run()` (the document
   * read) and sends the 80 %/100 % warning when it applies.
   */
  async warnIfThresholdReached(): Promise<void> {
    try {
      const quota = await this.quota();
      await this.warnAfterSpend(quota, 0);
    } catch (e) {
      this.logger.warn(`AI quota warning check failed: ${(e as Error)?.message}`);
    }
  }

  /**
   * Soft block for an AI call made outside `run()` (the document read): when
   * the plan quota is used up it records the skipped call and alerts once,
   * like the AI step, and returns the quota; null means the call may go on.
   */
  async blockedQuota(ref: WorkflowAiUsageRef): Promise<WorkflowAiQuota | null> {
    const quota = await this.quota();
    if (quota.state !== 'blocked') return null;
    await this.skipped(ref, quota);
    return quota;
  }

  private async skipped(ref: WorkflowAiUsageRef, quota: WorkflowAiQuota): Promise<WorkflowAiRunResult> {
    await this.recordUsage({ ...ref, status: 'skipped_quota' });
    await this.alertOnce(WORKFLOW_AI_BLOCK_PERCENT, quota);
    return { status: 'skipped_quota', quota };
  }

  private async warnAfterSpend(before: WorkflowAiQuota, spent: number): Promise<void> {
    if (!before.cap) return;
    const used = before.used + spent;
    const percent = Math.floor((used / before.cap) * 100);
    const after: WorkflowAiQuota = { ...before, used, percent, state: stateOf(percent) };
    if (percent >= WORKFLOW_AI_BLOCK_PERCENT) await this.alertOnce(WORKFLOW_AI_BLOCK_PERCENT, after);
    else if (percent >= WORKFLOW_AI_WARNING_PERCENT) await this.alertOnce(WORKFLOW_AI_WARNING_PERCENT, after);
  }

  /** One notification per store, threshold and month (Redis SET NX). */
  private async alertOnce(threshold: number, quota: WorkflowAiQuota): Promise<void> {
    const storeId = this.storeId();
    try {
      const key = `workflows:ai:quota-alert:${threshold}:${storeId}:${quota.period}`;
      const claimed = await this.redis.set(key, '1', 'EX', ALERT_TTL_SECONDS, 'NX');
      if (claimed !== 'OK') return;
      const blocked = threshold >= WORKFLOW_AI_BLOCK_PERCENT;
      await this.notifications.createAndBroadcast(
        storeId,
        'workflow_task',
        blocked ? WORKFLOW_AI_BLOCK_TITLE : WORKFLOW_AI_WARNING_TITLE,
        blocked
          ? 'Las solicitudes siguen su curso y los pasos de IA quedan para llenar a mano. Amplía tu plan para seguir usando la IA.'
          : `Llevas ${formatTokens(quota.used)} de ${formatTokens(quota.cap ?? 0)} tokens este mes. Al llegar al 100 % los pasos de IA pasan a revisión manual.`,
        { kind: 'workflow_ai_quota', threshold, period: quota.period, url: INSIGHTS_URL },
      );
    } catch (e) {
      this.logger.warn(`AI quota alert ${threshold}% of store ${storeId} failed: ${(e as Error)?.message}`);
    }
  }

  private storeId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) throw new Error('WorkflowAiService needs a store context');
    return storeId;
  }
}

function usageRef(input: WorkflowAiRunInput): WorkflowAiUsageRef {
  return {
    purpose: input.purpose,
    appKey: input.appKey,
    definitionId: input.definitionId ?? null,
    instanceId: input.instanceId ?? null,
    stageKey: input.stageKey ?? null,
  };
}

function stateOf(percent: number | null): WorkflowAiQuotaState {
  if (percent === null) return 'ok';
  if (percent >= WORKFLOW_AI_BLOCK_PERCENT) return 'blocked';
  if (percent >= WORKFLOW_AI_WARNING_PERCENT) return 'warning';
  return 'ok';
}

function tokensOf(response: AIResponse): WorkflowAiTokens {
  const prompt = response.usage?.promptTokens ?? 0;
  const completion = response.usage?.completionTokens ?? 0;
  return { prompt, completion, total: response.usage?.totalTokens ?? prompt + completion };
}

function parseJson(content: string): unknown {
  try {
    return parseAiJson(content);
  } catch {
    return null;
  }
}

/** UTC month, the same period as the plan counter in Redis. */
function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatTokens(n: number): string {
  return new Intl.NumberFormat('es-CO').format(n);
}
