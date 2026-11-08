import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { WORKFLOW_AI_STEP_APPLICATION } from '../../../../../prisma/seeds/workflow-ai-step.application';
import { WORKFLOW_INSIGHTS_SUMMARY_APPLICATION } from '../../../../../prisma/seeds/workflow-insights-summary.application';
import {
  WORKFLOW_AI_BLOCK_TITLE,
  WORKFLOW_AI_STEP_APP_KEY,
  WORKFLOW_AI_WARNING_TITLE,
  WORKFLOW_INSIGHTS_APP_KEY,
  WorkflowAiService,
} from './workflow-ai.service';

const STORE_ID = 10;

function build(opts: { used?: number; cap?: number | null; allowed?: boolean; reason?: string } = {}) {
  const ai = { run: jest.fn() };
  const create = jest.fn().mockResolvedValue({ id: 1 });
  const prisma = { workflow_ai_usage: { create } };
  const access = {
    canUseAIFeature: jest.fn().mockResolvedValue({ allowed: opts.allowed ?? true, reason: opts.reason }),
    getAIUsageSnapshot: jest.fn().mockResolvedValue({
      text_generation: { used: opts.used ?? 0, cap: opts.cap === undefined ? 1000 : opts.cap, period: 'monthly' },
    }),
  };
  const notifications = { createAndBroadcast: jest.fn().mockResolvedValue(undefined) };
  const claimed = new Set<string>();
  const redis = {
    set: jest.fn(async (key: string) => {
      if (claimed.has(key)) return null;
      claimed.add(key);
      return 'OK';
    }),
  };
  const service = new WorkflowAiService(ai as any, prisma as any, access as any, notifications as any, redis as any);
  return { service, ai, create, access, notifications, redis };
}

const input = {
  appKey: WORKFLOW_AI_STEP_APP_KEY,
  purpose: 'ai_step' as const,
  messages: [{ role: 'user' as const, content: '{}' }],
  definitionId: 7,
  instanceId: 70,
  stageKey: 'clasificar',
};

describe('WorkflowAiService', () => {
  beforeEach(() => jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID));
  afterEach(() => jest.restoreAllMocks());

  it('uses the app keys seeded by the AI applications', () => {
    expect(WORKFLOW_AI_STEP_APPLICATION.key).toBe(WORKFLOW_AI_STEP_APP_KEY);
    expect(WORKFLOW_INSIGHTS_SUMMARY_APPLICATION.key).toBe(WORKFLOW_INSIGHTS_APP_KEY);
    expect(WORKFLOW_AI_STEP_APPLICATION.ai_feature_category).toBe('text_generation');
    expect(WORKFLOW_INSIGHTS_SUMMARY_APPLICATION.ai_feature_category).toBe('text_generation');
  });

  describe('quota', () => {
    it.each([
      [100, 'ok', 10],
      [800, 'warning', 80],
      [1000, 'blocked', 100],
    ])('used %i of 1000 is %s', async (used, state, percent) => {
      const { service, access } = build({ used });
      await expect(service.quota()).resolves.toMatchObject({ state, used, cap: 1000, percent });
      expect(access.canUseAIFeature).toHaveBeenCalledWith(STORE_ID, 'text_generation');
    });

    it('is blocked when the plan gate reports the quota exhausted', async () => {
      const { service } = build({ used: 1, allowed: false, reason: 'SUBSCRIPTION_006' });
      await expect(service.quota()).resolves.toMatchObject({ state: 'blocked', reason: 'SUBSCRIPTION_006' });
    });

    it('is unavailable when the plan does not include AI text', async () => {
      const { service } = build({ allowed: false, reason: 'SUBSCRIPTION_005' });
      await expect(service.quota()).resolves.toMatchObject({ state: 'unavailable', reason: 'SUBSCRIPTION_005' });
    });

    it('has no percent without a monthly cap', async () => {
      const { service } = build({ used: 5000, cap: null });
      await expect(service.quota()).resolves.toMatchObject({ state: 'ok', cap: null, percent: null });
    });
  });

  describe('run', () => {
    it('calls the AI, parses the JSON and records the tokens against the store and the flow', async () => {
      const { service, ai, create, notifications } = build({ used: 100 });
      ai.run.mockResolvedValue({
        success: true,
        content: '```json\n{"values":{"tipo":"Queja"},"confidence":0.9}\n```',
        model: 'model-x',
        usage: { promptTokens: 30, completionTokens: 12, totalTokens: 42 },
      });

      const result = await service.run(input);

      expect(result).toEqual({
        status: 'success',
        content: expect.any(String),
        json: { values: { tipo: 'Queja' }, confidence: 0.9 },
        model: 'model-x',
        tokens: { prompt: 30, completion: 12, total: 42 },
      });
      expect(ai.run).toHaveBeenCalledWith(WORKFLOW_AI_STEP_APP_KEY, {}, input.messages);
      expect(create).toHaveBeenCalledWith({
        data: {
          store_id: STORE_ID,
          definition_id: 7,
          instance_id: 70,
          stage_key: 'clasificar',
          purpose: 'ai_step',
          app_key: WORKFLOW_AI_STEP_APP_KEY,
          model: 'model-x',
          prompt_tokens: 30,
          completion_tokens: 12,
          total_tokens: 42,
          status: 'success',
        },
      });
      expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
    });

    it('warns once at 80 % when a call crosses the threshold', async () => {
      const { service, ai, notifications } = build({ used: 790 });
      ai.run.mockResolvedValue({ success: true, content: '{}', usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 } });

      await service.run(input);
      await service.run(input);

      expect(notifications.createAndBroadcast).toHaveBeenCalledTimes(1);
      expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
        STORE_ID,
        'workflow_task',
        WORKFLOW_AI_WARNING_TITLE,
        expect.stringContaining('810'),
        expect.objectContaining({ kind: 'workflow_ai_quota', threshold: 80, url: '/admin/workflows/insights' }),
      );
    });

    it('soft-blocks at 100 %: no AI call, a skipped row and one alert per month', async () => {
      const { service, ai, create, notifications } = build({ used: 1000 });

      const first = await service.run(input);
      const second = await service.run(input);

      expect(first).toMatchObject({ status: 'skipped_quota', quota: { state: 'blocked', percent: 100 } });
      expect(second.status).toBe('skipped_quota');
      expect(ai.run).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'skipped_quota', total_tokens: 0, purpose: 'ai_step', definition_id: 7 }),
      });
      expect(notifications.createAndBroadcast).toHaveBeenCalledTimes(1);
      expect(notifications.createAndBroadcast.mock.calls[0][2]).toBe(WORKFLOW_AI_BLOCK_TITLE);
    });

    it('turns the plan gate 429 into a skipped call instead of a failure', async () => {
      const { service, ai, create } = build({ used: 10 });
      ai.run.mockRejectedValue(new VendixHttpException(ErrorCodes.SUBSCRIPTION_006));

      await expect(service.run(input)).resolves.toMatchObject({ status: 'skipped_quota', quota: { reason: 'SUBSCRIPTION_006' } });
      expect(create.mock.calls[0][0].data.status).toBe('skipped_quota');
    });

    it('reports a plan without AI as a failure that retrying cannot fix', async () => {
      const { service, ai, create } = build();
      ai.run.mockRejectedValue(new VendixHttpException(ErrorCodes.SUBSCRIPTION_005));

      await expect(service.run(input)).resolves.toMatchObject({ status: 'failed', code: 'SUBSCRIPTION_005', retryable: false });
      expect(create.mock.calls[0][0].data.status).toBe('failed');
    });

    it('reports a provider failure as retryable and keeps the tokens it spent', async () => {
      const { service, ai, create } = build();
      ai.run.mockResolvedValue({ success: false, error: 'timeout', usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 } });

      await expect(service.run(input)).resolves.toEqual({ status: 'failed', error: 'timeout', code: null, retryable: true });
      expect(create.mock.calls[0][0].data).toMatchObject({ status: 'failed', total_tokens: 5 });
    });

    it('returns null JSON when the answer is not JSON', async () => {
      const { service, ai } = build();
      ai.run.mockResolvedValue({ success: true, content: 'texto libre' });

      await expect(service.run(input)).resolves.toMatchObject({ status: 'success', json: null, tokens: { total: 0 } });
    });
  });

  it('never fails the caller when the ledger write fails', async () => {
    const { service, create } = build();
    create.mockRejectedValue(new Error('db down'));

    await expect(service.recordUsage({ purpose: 'document_read', status: 'success' })).resolves.toBeUndefined();
  });

  describe('blockedQuota (calls made outside run(), r1)', () => {
    const ref = { purpose: 'document_read' as const, appKey: 'document_extract', instanceId: 70, definitionId: 7 };

    it('at 100 % returns the quota, records the skipped call against the flow and alerts once', async () => {
      const { service, create, notifications } = build({ used: 1000 });

      await expect(service.blockedQuota(ref)).resolves.toMatchObject({ state: 'blocked', percent: 100 });
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'skipped_quota',
          purpose: 'document_read',
          instance_id: 70,
          definition_id: 7,
          total_tokens: 0,
        }),
      });
      expect(notifications.createAndBroadcast.mock.calls[0][2]).toBe(WORKFLOW_AI_BLOCK_TITLE);
    });

    it('below 100 % lets the call go on and writes nothing', async () => {
      const { service, create, notifications } = build({ used: 850 });

      await expect(service.blockedQuota(ref)).resolves.toBeNull();
      expect(create).not.toHaveBeenCalled();
      expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
    });
  });

  it('warns after a call made outside run() when the counter crossed 80 %', async () => {
    const { service, notifications } = build({ used: 850 });

    await service.warnIfThresholdReached();

    expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
      STORE_ID,
      'workflow_task',
      WORKFLOW_AI_WARNING_TITLE,
      expect.any(String),
      expect.objectContaining({ threshold: 80 }),
    );
  });
});
