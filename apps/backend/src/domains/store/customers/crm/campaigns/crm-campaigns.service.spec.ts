import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../../../common/errors';
import { CRM_CAMPAIGN_DISPATCH_EVENT, CrmCampaignsService } from './crm-campaigns.service';
import type { SegmentRecipientRow } from '../segments/crm-segment-query.service';

const STORE = 1;
const USER = 9;
const FUTURE = new Date(Date.now() + 86_400_000);

const recipient = (id: number, overrides: Partial<SegmentRecipientRow> = {}): SegmentRecipientRow => ({
  id,
  first_name: `C${id}`,
  last_name: 'L',
  email: `c${id}@shop.co`,
  phone: `30012345${String(id).padStart(2, '0')}`,
  whatsapp_consent: 'opted_in',
  sms_consent: 'unknown',
  email_consent: 'unknown',
  ...overrides,
});

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 30,
    name: 'Octubre',
    channel: 'sms',
    segment_id: 4,
    template_name: null,
    template_language: null,
    template_variables: null,
    body: 'Hola {first_name}, 20% hoy',
    subject: null,
    status: 'draft',
    scheduled_at: null,
    started_at: null,
    finished_at: null,
    recipients_total: 0,
    recipients_sent: 0,
    recipients_failed: 0,
    estimated_cost: null,
    created_by_user_id: USER,
    created_at: new Date(),
    updated_at: new Date(),
    segment: { id: 4, name: 'VIP' },
    ...overrides,
  };
}

function setup(options: {
  rows?: SegmentRecipientRow[];
  campaign?: ReturnType<typeof draft> | null;
  env?: Record<string, string>;
  smsChannel?: Record<string, unknown> | null;
  templates?: Array<Record<string, unknown>>;
} = {}) {
  const rows = options.rows ?? [recipient(1), recipient(2), recipient(3, { sms_consent: 'opted_out' })];
  const env: Record<string, string> = {
    SNS_SMS_PRICE_TABLE: '{"57":0.0075}',
    ...(options.env ?? {}),
  };
  const prisma = {
    crm_segments: { findFirst: jest.fn().mockResolvedValue({ filter: { op: 'and', rules: [] } }) },
    crm_campaigns: {
      findFirst: jest.fn().mockResolvedValue(options.campaign === undefined ? draft() : options.campaign),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...draft(), ...data, segment: { id: 4, name: 'VIP' } })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crm_messages: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      count: jest.fn().mockResolvedValue(0),
    },
    crm_message_templates: { findMany: jest.fn().mockResolvedValue(options.templates ?? []) },
    store_users: { count: jest.fn().mockResolvedValue(0) },
    social_channels: {
      findFirst: jest.fn().mockResolvedValue(
        options.smsChannel === undefined
          ? { id: 8, monthly_spend_limit: 10, monthly_spend_used: 0, spend_period_start: null }
          : options.smsChannel,
      ),
    },
    withoutScope: () => ({ stores: { findUnique: jest.fn().mockResolvedValue({ name: 'Tienda Sol' }) } }),
  };
  const segments = {
    resolve: jest.fn().mockResolvedValue({ store_id: STORE, filter: {}, from: {} }),
    recipients: jest.fn().mockResolvedValue(rows),
    count: jest.fn().mockResolvedValue(rows.length),
    canReadContact: jest.fn().mockReturnValue(false),
  };
  const messaging = { isDryRun: jest.fn().mockReturnValue(env.MESSAGING_DRY_RUN === 'true') };
  const smsSpend = {
    snapshot: jest.fn((row: { monthly_spend_limit: number; monthly_spend_used: number }) => ({
      period_start: '2026-10-01',
      limit: row.monthly_spend_limit,
      used: row.monthly_spend_used,
      remaining: row.monthly_spend_limit - row.monthly_spend_used,
    })),
  };
  const config = { get: jest.fn((key: string) => env[key]) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const events = { emit: jest.fn() };
  const service = new CrmCampaignsService(
    prisma as never,
    segments as never,
    messaging as never,
    smsSpend as never,
    config as never,
    audit as never,
    events as never,
  );
  return { service, prisma, segments, audit, events, smsSpend };
}

const asStore = <T>(fn: () => Promise<T>) =>
  RequestContextService.runIsolated(
    { store_id: STORE, user_id: USER, is_super_admin: false, is_owner: false },
    fn,
  );

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VendixHttpException);
    return (error as VendixHttpException).errorCode;
  }
  throw new Error('expected a VendixHttpException');
};

describe('CrmCampaignsService', () => {
  describe('estimate', () => {
    it('counts recipients, excludes opt-outs and estimates the SMS cost against the cap', async () => {
      const { service } = setup();
      const estimate = await asStore(() =>
        service.estimate({ segment_id: 4, channel: 'sms', body: 'Hola {first_name}' }),
      );
      expect(estimate).toMatchObject({
        segment_total: 3,
        recipients: 2,
        excluded_no_consent: 1,
        estimated_cost: 0.015,
        currency: 'USD',
        spend_remaining: 10,
        exceeds_spend_limit: false,
        template_verified: null,
      });
    });

    it('flags an SMS campaign that does not fit in the remaining monthly cap', async () => {
      const { service } = setup({
        smsChannel: { id: 8, monthly_spend_limit: 0.01, monthly_spend_used: 0, spend_period_start: null },
      });
      const estimate = await asStore(() =>
        service.estimate({ segment_id: 4, channel: 'sms', body: 'Hola' }),
      );
      expect(estimate).toMatchObject({ estimated_cost: 0.015, spend_remaining: 0.01, exceeds_spend_limit: true });
    });

    it('only counts explicit WhatsApp opt-ins', async () => {
      const { service } = setup({
        rows: [recipient(1), recipient(2, { whatsapp_consent: 'unknown' }), recipient(3, { whatsapp_consent: 'opted_out' })],
      });
      const estimate = await asStore(() =>
        service.estimate({ segment_id: 4, channel: 'whatsapp', template: { name: 'promo', language: 'es' } }),
      );
      expect(estimate).toMatchObject({ recipients: 1, excluded_no_consent: 2, estimated_cost: 0.05, template_verified: false });
    });

    it('detects a segment larger than the campaign maximum', async () => {
      const { service, segments } = setup({ env: { CRM_CAMPAIGN_MAX_RECIPIENTS: '2' } });
      const estimate = await asStore(() => service.estimate({ segment_id: 4, channel: 'email', subject: 'Hola', body: 'x' }));
      expect(estimate).toMatchObject({ max_recipients: 2, exceeds_max_recipients: true });
      // Asks for one more than the cap to detect overflow without loading the whole segment.
      expect(segments.recipients).toHaveBeenCalledWith(expect.anything(), 2);
    });

    it('answers 404 for a segment of another store (scoped lookup)', async () => {
      const { service, prisma } = setup();
      prisma.crm_segments.findFirst.mockResolvedValue(null);
      await expect(
        errorCode(asStore(() => service.estimate({ segment_id: 99, channel: 'sms', body: 'x' }))),
      ).resolves.toBe('CRM_SEGMENT_002');
    });
  });

  describe('content (closed catalog)', () => {
    it.each([
      [{ segment_id: 4, channel: 'sms', body: 'Tu clave es {password}' }, 'CRM_CAMPAIGN_004'],
      [{ segment_id: 4, channel: 'sms' }, 'CRM_CAMPAIGN_004'],
      [{ segment_id: 4, channel: 'email', body: 'sin asunto' }, 'CRM_CAMPAIGN_004'],
      [{ segment_id: 4, channel: 'whatsapp', body: 'texto libre' }, 'CRM_CAMPAIGN_004'],
    ])('rejects %o', async (dto, code) => {
      const { service } = setup();
      await expect(errorCode(asStore(() => service.estimate(dto as never)))).resolves.toBe(code);
    });

    it('requires a cached WhatsApp template to be APPROVED and MARKETING, with its variables', async () => {
      const utility = setup({ templates: [{ status: 'APPROVED', category: 'UTILITY', components: [] }] });
      await expect(
        errorCode(asStore(() => utility.service.estimate({ segment_id: 4, channel: 'whatsapp', template: { name: 'aviso', language: 'es' } }))),
      ).resolves.toBe('CRM_CAMPAIGN_004');

      const body = [{ type: 'BODY', text: 'Hola {{1}}, {{2}}' }];
      const marketing = setup({ templates: [{ status: 'APPROVED', category: 'MARKETING', components: body }] });
      await expect(
        errorCode(asStore(() => marketing.service.estimate({ segment_id: 4, channel: 'whatsapp', template: { name: 'promo', language: 'es', variables: ['{first_name}'] } }))),
      ).resolves.toBe('CRM_CAMPAIGN_004');
      const ok = await asStore(() =>
        marketing.service.estimate({ segment_id: 4, channel: 'whatsapp', template: { name: 'promo', language: 'es', variables: ['{first_name}', '20%'] } }),
      );
      expect(ok.template_verified).toBe(true);
    });

    it('rejects a schedule in the past', async () => {
      const { service } = setup();
      await expect(
        errorCode(asStore(() => service.create({ name: 'x', segment_id: 4, channel: 'sms', body: 'x', scheduled_at: '2020-01-01T00:00:00Z' }))),
      ).resolves.toBe('CRM_CAMPAIGN_007');
    });

    it('creates a draft with the estimate and the store of the request', async () => {
      const { service, prisma } = setup();
      const created = await asStore(() => service.create({ name: ' Octubre ', segment_id: 4, channel: 'sms', body: 'Hola' }));
      expect(prisma.crm_campaigns.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ store_id: STORE, name: 'Octubre', status: 'draft', estimated_cost: 0.015, created_by_user_id: USER }),
        }),
      );
      expect(created.estimate.recipients).toBe(2);
    });
  });

  describe('send', () => {
    it('refuses a confirmation that does not match the current estimate, without touching the campaign', async () => {
      const { service, prisma, events } = setup();
      await expect(errorCode(asStore(() => service.send(30, 0.0075)))).resolves.toBe('CRM_CAMPAIGN_003');
      expect(prisma.crm_campaigns.updateMany).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('starts sending when the confirmed cost matches, audits it and wakes the dispatcher', async () => {
      const { service, prisma, events, audit } = setup();
      await asStore(() => service.send(30, 0.015));
      expect(prisma.crm_campaigns.updateMany).toHaveBeenCalledWith({
        where: { id: 30, status: 'draft' },
        data: expect.objectContaining({ status: 'sending', estimated_cost: 0.015 }),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: STORE,
          resource: 'crm_campaigns',
          metadata: expect.objectContaining({ reason: 'crm_campaign_send', recipients: 2, excluded_no_consent: 1, estimated_cost: 0.015 }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(CRM_CAMPAIGN_DISPATCH_EVENT, { campaign_id: 30 });
    });

    it('schedules a campaign with a future date without dispatching it yet', async () => {
      const { service, prisma, events } = setup({ campaign: draft({ scheduled_at: FUTURE }) });
      await asStore(() => service.send(30, 0.015));
      expect(prisma.crm_campaigns.updateMany).toHaveBeenCalledWith({
        where: { id: 30, status: 'draft' },
        data: expect.objectContaining({ status: 'scheduled' }),
      });
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('refuses an SMS campaign that would exceed the store spend cap (#1032)', async () => {
      const { service, prisma } = setup({
        smsChannel: { id: 8, monthly_spend_limit: 0.01, monthly_spend_used: 0, spend_period_start: null },
      });
      await expect(errorCode(asStore(() => service.send(30, 0.015)))).resolves.toBe('CRM_SMS_SPEND_LIMIT');
      expect(prisma.crm_campaigns.updateMany).not.toHaveBeenCalled();
    });

    it('refuses an SMS campaign when the store has no SMS channel (no cap to respect)', async () => {
      const { service } = setup({ smsChannel: null });
      await expect(errorCode(asStore(() => service.send(30, 0.015)))).resolves.toBe('CRM_SMS_SPEND_LIMIT');
    });

    it('refuses a campaign whose whole segment opted out', async () => {
      const { service } = setup({ rows: [recipient(1, { sms_consent: 'opted_out' })] });
      await expect(errorCode(asStore(() => service.send(30, 0)))).resolves.toBe('CRM_CAMPAIGN_005');
    });

    it('only sends drafts', async () => {
      const { service } = setup({ campaign: draft({ status: 'sent' }) });
      await expect(errorCode(asStore(() => service.send(30, 0.015)))).resolves.toBe('CRM_CAMPAIGN_002');
    });

    it('answers 404 for a campaign of another store', async () => {
      const { service } = setup({ campaign: null });
      await expect(errorCode(asStore(() => service.send(30, 0.015)))).resolves.toBe('CRM_CAMPAIGN_001');
      await expect(errorCode(asStore(() => service.get(30)))).resolves.toBe('CRM_CAMPAIGN_001');
      await expect(errorCode(asStore(() => service.cancel(30)))).resolves.toBe('CRM_CAMPAIGN_001');
    });
  });

  it('cancel drops the messages still queued', async () => {
    const { service, prisma } = setup({ campaign: draft({ status: 'sending', started_at: new Date() }) });
    await asStore(() => service.cancel(30));
    expect(prisma.crm_messages.updateMany).toHaveBeenCalledWith({
      where: { campaign_id: 30, status: 'queued' },
      data: expect.objectContaining({ status: 'failed', error_code: 'CAMPAIGN_CANCELLED' }),
    });
  });

  it('reports the funnel with delivery, reads and opt-outs since the start', async () => {
    const started = new Date('2026-10-30T10:00:00Z');
    const { service, prisma } = setup({ campaign: draft({ status: 'sent', started_at: started }) });
    prisma.crm_messages.groupBy
      .mockResolvedValueOnce([
        { status: 'sent', _count: { _all: 2 } },
        { status: 'delivered', _count: { _all: 3 } },
        { status: 'read', _count: { _all: 4 } },
        { status: 'failed', _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([{ error_code: 'OPTED_OUT', _count: { _all: 1 } }]);
    prisma.crm_messages.findMany.mockResolvedValue([
      { conversation: { customer_id: 1 } },
      { conversation: { customer_id: 2 } },
    ]);
    prisma.store_users.count.mockResolvedValue(1);

    const result = await asStore(() => service.get(30));

    expect(result.metrics).toEqual({
      queued: 0,
      sent: 9,
      delivered: 7,
      read: 4,
      failed: 1,
      opted_out: 1,
      failed_by_reason: { OPTED_OUT: 1 },
    });
    expect(prisma.store_users.count).toHaveBeenCalledWith({
      where: { user_id: { in: [1, 2] }, sms_consent: 'opted_out', consent_updated_at: { gte: started } },
    });
  });
});
