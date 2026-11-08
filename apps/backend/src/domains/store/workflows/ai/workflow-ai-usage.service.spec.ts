import { RequestContextService } from '../../../../common/context/request-context.service';
import { NO_FLOW_LABEL, WorkflowAiUsageService } from './workflow-ai-usage.service';

const STORE_ID = 10;
const NOW = new Date('2026-11-07T15:00:00Z');
const QUOTA = { state: 'ok', used: 10, cap: 100, percent: 10, period: '2026-11', reason: null };

type Group = { definition_id: number | null; purpose: string; status: string; calls: number; tokens: number };

function build(groups: Group[] = []) {
  const groupBy = jest.fn().mockResolvedValue(
    groups.map((g) => ({
      definition_id: g.definition_id,
      purpose: g.purpose,
      status: g.status,
      _count: { _all: g.calls },
      _sum: { total_tokens: g.tokens },
    })),
  );
  const findMany = jest.fn().mockResolvedValue([
    { id: 1, name: 'PQR' },
    { id: 2, name: 'Vacaciones' },
  ]);
  const prisma = { workflow_ai_usage: { groupBy }, workflow_definitions: { findMany } };
  const ai = { quota: jest.fn().mockResolvedValue(QUOTA) };
  return { service: new WorkflowAiUsageService(prisma as any, ai as any), groupBy, findMany, ai };
}

describe('WorkflowAiUsageService', () => {
  beforeEach(() => jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID));
  afterEach(() => jest.restoreAllMocks());

  it('aggregates by flow (tokens desc) and by purpose with all four purposes', async () => {
    const { service } = build([
      { definition_id: 1, purpose: 'ai_step', status: 'success', calls: 3, tokens: 300 },
      { definition_id: 1, purpose: 'ai_step_test', status: 'success', calls: 1, tokens: 50 },
      { definition_id: 2, purpose: 'ai_step', status: 'failed', calls: 2, tokens: 700 },
      { definition_id: null, purpose: 'insights_summary', status: 'success', calls: 1, tokens: 20 },
      { definition_id: 1, purpose: 'ai_step', status: 'skipped_quota', calls: 4, tokens: 0 },
    ]);
    const report = await service.report(undefined, NOW);
    expect(report.month).toBe('2026-11');
    expect(report.flows_tokens).toBe(1070);
    expect(report.calls).toBe(7);
    expect(report.skipped).toBe(4);
    expect(report.by_flow).toEqual([
      { definition_id: 2, name: 'Vacaciones', calls: 2, tokens: 700 },
      { definition_id: 1, name: 'PQR', calls: 4, tokens: 350 },
      { definition_id: null, name: NO_FLOW_LABEL, calls: 1, tokens: 20 },
    ]);
    expect(report.by_purpose).toEqual([
      { purpose: 'ai_step', calls: 5, tokens: 1000 },
      { purpose: 'ai_step_test', calls: 1, tokens: 50 },
      { purpose: 'document_read', calls: 0, tokens: 0 },
      { purpose: 'insights_summary', calls: 1, tokens: 20 },
    ]);
  });

  it('queries only this store and the UTC bounds of the month', async () => {
    const { service, groupBy } = build();
    await service.report('2026-02', NOW);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          store_id: STORE_ID,
          created_at: { gte: new Date('2026-02-01T00:00:00Z'), lt: new Date('2026-03-01T00:00:00Z') },
        },
      }),
    );
  });

  it('returns zeros for a month without usage', async () => {
    const { service } = build();
    const report = await service.report('2026-10', NOW);
    expect(report).toMatchObject({ flows_tokens: 0, calls: 0, skipped: 0, by_flow: [] });
    expect(report.by_purpose).toHaveLength(4);
  });

  it('carries the plan quota only for the current month', async () => {
    const { service, ai } = build();
    await expect(service.report('2026-11', NOW)).resolves.toMatchObject({ quota: QUOTA });
    ai.quota.mockClear();
    await expect(service.report('2026-10', NOW)).resolves.toMatchObject({ quota: null });
    expect(ai.quota).not.toHaveBeenCalled();
  });

  it.each(['2026-13', '2026-1', 'noviembre', '2026-12', '2025-10', '2024-01'])(
    'rejects month %s',
    async (month) => {
      const { service } = build();
      await expect(service.report(month, NOW)).rejects.toMatchObject({ errorCode: 'WORKFLOW_AI_USAGE_MONTH_INVALID' });
    },
  );

  it('accepts the oldest month of the window (11 months back)', async () => {
    const { service } = build();
    await expect(service.report('2025-12', NOW)).resolves.toMatchObject({ month: '2025-12' });
  });
});
