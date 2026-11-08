import { RequestContextService } from '../../../../common/context/request-context.service';
import { WorkflowInsightsCron } from './workflow-insights.cron';

// Mon 2026-11-09 13:00Z = 08:00 Bogota (UTC-5) = 14:00 Madrid = 05:00 Los Angeles (UTC-8)
const MONDAY_13Z = new Date('2026-11-09T13:00:00Z');

function build(opts: { stores?: Array<{ id: number; tz: string; industries?: string[] }>; lock?: boolean } = {}) {
  const stores = opts.stores ?? [{ id: 1, tz: 'America/Bogota' }];
  const db = {
    workflow_definitions: {
      findMany: jest.fn().mockResolvedValue(stores.map((s) => ({ store_id: s.id, organization_id: s.id * 100 }))),
    },
    stores: {
      findFirst: jest.fn(async ({ where }: any) => {
        const s = stores.find((x) => x.id === where.id);
        return { industries: s?.industries ?? ['administration'] };
      }),
    },
  };
  const prisma = {
    withoutScope: () => db,
    store_settings: {
      findFirst: jest.fn(async () => {
        const id = RequestContextService.getStoreId();
        return { settings: {}, stores: { timezone: stores.find((s) => s.id === id)?.tz } };
      }),
    },
  };
  const generated: number[] = [];
  const insights = {
    generateWeekly: jest.fn(async () => {
      generated.push(RequestContextService.getStoreId() as number);
      return { id: 1 };
    }),
  };
  const redis = { set: jest.fn().mockResolvedValue(opts.lock === false ? null : 'OK') };
  const cron = new WorkflowInsightsCron(prisma as any, insights as any, redis as any);
  return { cron, insights, generated, redis, db };
}

describe('WorkflowInsightsCron', () => {
  afterEach(() => jest.restoreAllMocks());

  it('generates inside the store context when it is Monday 08:00 store-local', async () => {
    const { cron, generated } = build();
    await expect(cron.runOnce(MONDAY_13Z)).resolves.toBe(1);
    expect(generated).toEqual([1]);
  });

  it.each([
    ['not Monday (Sunday 08:00 Bogota)', new Date('2026-11-08T13:00:00Z')],
    ['Monday 07:00 Bogota', new Date('2026-11-09T12:00:00Z')],
  ])('skips the store %s', async (_name, now) => {
    const { cron, insights } = build();
    await expect(cron.runOnce(now)).resolves.toBe(0);
    expect(insights.generateWeekly).not.toHaveBeenCalled();
  });

  it('catches up later that Monday when the 08:00 run was missed', async () => {
    const { cron, generated } = build();
    await expect(cron.runOnce(new Date('2026-11-09T15:00:00Z'))).resolves.toBe(1); // 10:00 Bogota
    expect(generated).toEqual([1]);
  });

  it('decides per store time zone: only the stores whose local Monday reached 08:00', async () => {
    const { cron, generated } = build({
      stores: [
        { id: 1, tz: 'America/Bogota' },
        { id: 2, tz: 'Europe/Madrid' },
        { id: 3, tz: 'America/Los_Angeles' },
      ],
    });
    await cron.runOnce(new Date('2026-11-09T07:00:00Z')); // 08:00 Madrid, 02:00 Bogota, Sunday in Los Angeles
    expect(generated).toEqual([2]);
    generated.length = 0;
    await cron.runOnce(MONDAY_13Z); // 08:00 Bogota, 14:00 Madrid (the service skips its existing week), 05:00 Los Angeles
    expect(generated).toEqual([1, 2]);
  });

  it('skips stores whose industry no longer has Flows', async () => {
    const { cron, insights } = build({ stores: [{ id: 1, tz: 'America/Bogota', industries: ['retail'] }] });
    await expect(cron.runOnce(MONDAY_13Z)).resolves.toBe(0);
    expect(insights.generateWeekly).not.toHaveBeenCalled();
  });

  it('counts only stores that actually got a new summary', async () => {
    const { cron, insights } = build({ stores: [{ id: 1, tz: 'America/Bogota' }, { id: 2, tz: 'America/Bogota' }] });
    insights.generateWeekly.mockResolvedValueOnce(null as never);
    await expect(cron.runOnce(MONDAY_13Z)).resolves.toBe(1);
  });

  it('one failing store never stops the others', async () => {
    const { cron, insights } = build({ stores: [{ id: 1, tz: 'America/Bogota' }, { id: 2, tz: 'America/Bogota' }] });
    insights.generateWeekly.mockRejectedValueOnce(new Error('boom') as never);
    await expect(cron.runOnce(MONDAY_13Z)).resolves.toBe(1);
    expect(insights.generateWeekly).toHaveBeenCalledTimes(2);
  });

  describe('handle', () => {
    it('does nothing when another instance holds the hourly lock', async () => {
      const { cron, db, redis } = build({ lock: false });
      await cron.handle();
      expect(redis.set).toHaveBeenCalledWith(expect.stringMatching(/^workflows:insights:cron:/), '1', 'EX', expect.any(Number), 'NX');
      expect(db.workflow_definitions.findMany).not.toHaveBeenCalled();
    });

    it('runs when it wins the lock', async () => {
      const { cron, db } = build();
      await cron.handle();
      expect(db.workflow_definitions.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
