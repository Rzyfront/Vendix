import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SMS_SPEND_LIMIT_REACHED_EVENT,
  SmsSpendService,
} from './sms-spend.service';

const OCT = new Date('2026-10-15T12:00:00Z');

function setup() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    social_channels: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const redisKeys = new Set<string>();
  const redis = {
    set: jest.fn(async (key: string, _v: string, _ex: string, _ttl: number, nx: string) => {
      if (nx === 'NX' && redisKeys.has(key)) return null;
      redisKeys.add(key);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => (redisKeys.delete(key) ? 1 : 0)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const events = { emit: jest.fn() };
  const service = new SmsSpendService(
    prisma as never,
    redis as never,
    audit as never,
    events as never,
  );
  return { service, prisma, redis, audit, events };
}

const row = (limit: string | null, used: string, period: string | null) => ({
  monthly_spend_limit: limit === null ? null : new Prisma.Decimal(limit),
  monthly_spend_used: new Prisma.Decimal(used),
  spend_period_start: period ? new Date(`${period}T00:00:00Z`) : null,
});

describe('SmsSpendService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses the UTC calendar month as period', () => {
    const { service } = setup();
    expect(service.currentPeriod(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10-01');
    expect(service.currentPeriod(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01');
  });

  describe('reserve', () => {
    it('reserves with one conditional UPDATE … RETURNING scoped to the channel and store', async () => {
      const { service, prisma } = setup();
      prisma.$queryRaw.mockResolvedValue([{ used: '3.0075', limit: '10.00' }]);

      const result = await service.reserve({ id: 7, store_id: 10 }, 0.0075, OCT);

      expect(result).toEqual({ reserved: true, period_start: '2026-10-01', used: 3.0075, limit: 10 });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      const text = sql.sql.replace(/\s+/g, ' ');
      expect(text).toContain('UPDATE "social_channels"');
      expect(text).toContain('"monthly_spend_limit" IS NOT NULL');
      expect(text).toMatch(/\+ \?::numeric <= "monthly_spend_limit"/);
      expect(text).toContain('RETURNING');
      expect(sql.values).toEqual(
        expect.arrayContaining(['2026-10-01', '0.0075', 7, 10]),
      );
      // Never read-then-write: the counter is only read after a rejection.
      expect(prisma.social_channels.findFirst).not.toHaveBeenCalled();
    });

    it('when the cap is used up: rejects, logs it in audit and notifies the owner once per month', async () => {
      const { service, prisma, audit, events } = setup();
      prisma.social_channels.findFirst.mockResolvedValue(row('10', '9.9990', '2026-10-01'));

      const first = await service.reserve({ id: 7, store_id: 10 }, 0.0075, OCT);
      const second = await service.reserve({ id: 7, store_id: 10 }, 0.0075, OCT);

      expect(first).toEqual({ reserved: false, period_start: '2026-10-01', used: 9.999, limit: 10 });
      expect(second.reserved).toBe(false);
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: 10,
          action: 'CUSTOM',
          resource: 'social_channels',
          resourceId: 7,
          metadata: expect.objectContaining({
            reason: 'crm_sms_spend_limit_reached',
            limit: 10,
            used: 9.999,
            attempted_cost: 0.0075,
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith(SMS_SPEND_LIMIT_REACHED_EVENT, {
        store_id: 10,
        channel_id: 7,
        period_start: '2026-10-01',
        limit: 10,
        used: 9.999,
        attempted_cost: 0.0075,
      });
    });

    it('notifies again after the owner changes the cap', async () => {
      const { service, prisma, events } = setup();
      prisma.social_channels.findFirst.mockResolvedValue(row('10', '10', '2026-10-01'));

      await service.reserve({ id: 7, store_id: 10 }, 0.0075, OCT);
      await service.resetLimitNotice(10, OCT);
      await service.reserve({ id: 7, store_id: 10 }, 0.0075, OCT);

      expect(events.emit).toHaveBeenCalledTimes(2);
    });

    it('rejects negative or non-finite amounts', async () => {
      const { service } = setup();
      await expect(service.reserve({ id: 7, store_id: 10 }, -1)).rejects.toThrow('Invalid SMS spend amount');
      await expect(service.reserve({ id: 7, store_id: 10 }, NaN)).rejects.toThrow('Invalid SMS spend amount');
    });
  });

  it('release subtracts only within the same month and never fails the send', async () => {
    const { service, prisma } = setup();

    await service.release({ id: 7, store_id: 10 }, 0.0075, '2026-10-01');
    const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql.replace(/\s+/g, ' ')).toContain('GREATEST("monthly_spend_used" - ?::numeric, 0)');
    expect(sql.sql).toContain('"store_id" = ?');
    expect(sql.sql).toContain('"spend_period_start" = ?::date');
    expect(sql.values).toEqual(['0.0075', 7, 10, '2026-10-01']);

    prisma.$queryRaw.mockRejectedValueOnce(new Error('db down'));
    await expect(service.release({ id: 7, store_id: 10 }, 0.0075, '2026-10-01')).resolves.toBeUndefined();
  });

  describe('snapshot', () => {
    it('reads the counter of the current month, and 0 for a past month', () => {
      const { service } = setup();
      expect(service.snapshot(row('10', '2.5', '2026-10-01'), OCT)).toEqual({
        period_start: '2026-10-01',
        limit: 10,
        used: 2.5,
        remaining: 7.5,
      });
      expect(service.snapshot(row('10', '9', '2026-09-01'), OCT)).toMatchObject({ used: 0, remaining: 10 });
      expect(service.snapshot(row(null, '0', null), OCT)).toMatchObject({ limit: null, remaining: null });
    });
  });

  describe('assertAvailable', () => {
    it.each([
      ['used up', row('10', '10', '2026-10-01')],
      ['no cap set', row(null, '0', null)],
      ['cap 0', row('0', '0', null)],
    ])('throws CRM_SMS_SPEND_LIMIT when %s', async (_label, channel) => {
      const { service, prisma } = setup();
      prisma.social_channels.findFirst.mockResolvedValue(channel);
      await expect(service.assertAvailable(10, OCT)).rejects.toMatchObject({
        errorCode: 'CRM_SMS_SPEND_LIMIT',
      });
      expect(prisma.social_channels.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { store_id: 10, channel_type: 'sms', provider: 'sns_sms', status: 'connected' },
        }),
      );
    });

    it('spend exactly at the cap: rejects and alerts the owner once per month (B1)', async () => {
      const { service, prisma, audit, events } = setup();
      prisma.social_channels.findFirst.mockResolvedValue({ id: 7, ...row('3', '3.0000', '2026-10-01') });

      await expect(service.assertAvailable(10, OCT)).rejects.toMatchObject({ errorCode: 'CRM_SMS_SPEND_LIMIT' });
      await expect(service.assertAvailable(10, OCT)).rejects.toMatchObject({ errorCode: 'CRM_SMS_SPEND_LIMIT' });

      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith(SMS_SPEND_LIMIT_REACHED_EVENT, {
        store_id: 10,
        channel_id: 7,
        period_start: '2026-10-01',
        limit: 3,
        used: 3,
        attempted_cost: 0,
      });
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ storeId: 10, resource: 'social_channels', resourceId: 7 }),
      );
    });

    it('passes with budget left (a past month counts as fresh) or without a channel', async () => {
      const { service, prisma } = setup();
      prisma.social_channels.findFirst.mockResolvedValueOnce(row('10', '10', '2026-09-01'));
      await expect(service.assertAvailable(10, OCT)).resolves.toBeUndefined();
      prisma.social_channels.findFirst.mockResolvedValueOnce(null);
      await expect(service.assertAvailable(10, OCT)).resolves.toBeUndefined();
    });
  });
});
