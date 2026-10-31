import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { MessagingChannelsService } from './messaging-channels.service';
import { SmsSpendService } from '../../../../messaging/spend/sms-spend.service';

type Row = Record<string, any>;

const STORE = 10;
const USER = 5;

function setup(initial: Row[] = []) {
  let nextId = 100;
  const rows: Row[] = initial.map((r) => ({ ...r }));
  // Scoped client: the store filter is implicit, like StorePrismaService.
  const matches = (row: Row, where: Row) =>
    row.store_id === STORE &&
    Object.entries(where).every(([k, v]) => row[k] === v);
  const prisma = {
    social_channels: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data, { updated_at: new Date() }));
        return { count: hit.length };
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: nextId++,
          connected_at: null,
          disconnected_at: null,
          monthly_spend_limit: null,
          monthly_spend_used: new Prisma.Decimal(0),
          spend_period_start: null,
          updated_at: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      }),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const smsSpend = {
    resetLimitNotice: jest.fn().mockResolvedValue(undefined),
    snapshot: jest.fn(
      (row: Row) => new SmsSpendService(null as never, null as never, null as never, null as never).snapshot(row as never),
    ),
  };
  const service = new MessagingChannelsService(prisma as never, audit as never, smsSpend as never);
  return { service, prisma, rows, audit, smsSpend };
}

describe('MessagingChannelsService', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(USER);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('PUT /sms', () => {
    it('creates the SMS channel with its cap, never touching the spend counter', async () => {
      const { service, rows, audit, smsSpend } = setup();

      const view = await service.updateSms({ enabled: true, sender_id: 'Tienda', monthly_spend_limit: 25 });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        store_id: STORE,
        channel_type: 'sms',
        provider: 'sns_sms',
        status: 'connected',
        metadata: { sender_id: 'Tienda' },
      });
      expect(rows[0].connected_at).toBeInstanceOf(Date);
      expect(Number(rows[0].monthly_spend_limit)).toBe(25);
      expect(Number(rows[0].monthly_spend_used)).toBe(0);
      expect(view).toMatchObject({
        channel_type: 'sms',
        enabled: true,
        sender_id: 'Tienda',
        spend: { currency: 'USD', limit: 25, used: 0, remaining: 25 },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          storeId: STORE,
          action: 'CREATE',
          resource: 'social_channels',
          newValues: { enabled: true, sender_id: 'Tienda', monthly_spend_limit: 25 },
        }),
      );
      expect(smsSpend.resetLimitNotice).toHaveBeenCalledWith(STORE);
    });

    it('updates the existing row, keeps the month spend, audits old and new values', async () => {
      const period = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
      const { service, rows, audit, prisma, smsSpend } = setup([
        {
          id: 7,
          store_id: STORE,
          channel_type: 'sms',
          provider: 'sns_sms',
          status: 'connected',
          metadata: { sender_id: 'Viejo', extra: 1 },
          connected_at: new Date('2026-01-01'),
          disconnected_at: null,
          monthly_spend_limit: new Prisma.Decimal(10),
          monthly_spend_used: new Prisma.Decimal('4.5'),
          spend_period_start: period,
          updated_at: new Date(),
        },
      ]);

      const view = await service.updateSms({ enabled: false, monthly_spend_limit: 10 });

      expect(prisma.social_channels.create).not.toHaveBeenCalled();
      expect(rows[0]).toMatchObject({ status: 'disconnected', metadata: { sender_id: null, extra: 1 } });
      expect(rows[0].disconnected_at).toBeInstanceOf(Date);
      expect(Number(rows[0].monthly_spend_used)).toBe(4.5);
      expect(view).toMatchObject({ enabled: false, spend: { limit: 10, used: 4.5, remaining: 5.5 } });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          resourceId: 7,
          oldValues: { enabled: true, sender_id: 'Viejo', monthly_spend_limit: 10 },
          newValues: { enabled: false, sender_id: null, monthly_spend_limit: 10 },
        }),
      );
      // Same cap: the "limit reached" alert is not re-armed.
      expect(smsSpend.resetLimitNotice).not.toHaveBeenCalled();
    });

    it('never writes another store channel', async () => {
      const { service, rows } = setup([
        { id: 9, store_id: 99, channel_type: 'sms', provider: 'sns_sms', status: 'connected', metadata: {}, monthly_spend_limit: new Prisma.Decimal(1) },
      ]);
      await service.updateSms({ enabled: true, monthly_spend_limit: 50 });
      expect(rows.find((r) => r.id === 9)).toMatchObject({ store_id: 99, status: 'connected' });
      expect(Number(rows.find((r) => r.id === 9)!.monthly_spend_limit)).toBe(1);
      expect(rows.filter((r) => r.store_id === STORE)).toHaveLength(1);
    });
  });

  describe('PUT /email', () => {
    it('saves sender name and reply-to on the email channel', async () => {
      const { service, rows, audit } = setup();

      const view = await service.updateEmail({ enabled: true, from_name: 'Tienda Centro', reply_to: 'hola@tienda.co' });

      expect(rows[0]).toMatchObject({
        channel_type: 'email',
        provider: 'ses_email',
        status: 'connected',
        metadata: { from_name: 'Tienda Centro', reply_to: 'hola@tienda.co' },
      });
      expect(view).toEqual(
        expect.objectContaining({ enabled: true, from_name: 'Tienda Centro', reply_to: 'hola@tienda.co' }),
      );
      expect(view).not.toHaveProperty('spend');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', resource: 'social_channels' }));
    });
  });

  describe('GET /', () => {
    it('returns both channels of the store, null when not configured yet', async () => {
      const { service } = setup([
        {
          id: 7,
          store_id: STORE,
          channel_type: 'sms',
          provider: 'sns_sms',
          status: 'connected',
          metadata: { sender_id: 'Tienda' },
          connected_at: new Date('2026-10-01T00:00:00Z'),
          disconnected_at: null,
          monthly_spend_limit: new Prisma.Decimal(20),
          monthly_spend_used: new Prisma.Decimal(3.5),
          spend_period_start: null,
          updated_at: new Date(),
        },
        // Another store's email channel must not leak.
        { id: 8, store_id: 99, channel_type: 'email', provider: 'ses_email', status: 'connected', metadata: {} },
      ]);

      const view = await service.list();

      expect(view.sms).toMatchObject({ id: 7, enabled: true, sender_id: 'Tienda', spend: expect.objectContaining({ currency: 'USD', limit: 20 }) });
      expect(view.email).toBeNull();
    });
  });

  it('requires a store context', async () => {
    (RequestContextService.getStoreId as jest.Mock).mockReturnValue(undefined);
    const { service } = setup();
    await expect(service.updateEmail({ enabled: true })).rejects.toThrow('Se requiere contexto de tienda');
  });
});
