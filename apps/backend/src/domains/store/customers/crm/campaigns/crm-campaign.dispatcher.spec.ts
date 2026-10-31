import { Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { CrmCampaignDispatcher } from './crm-campaign.dispatcher';
import { CrmCampaignsService } from './crm-campaigns.service';
import { CrmUnsubscribeService } from './crm-unsubscribe.service';

const NOW = new Date('2026-10-31T15:00:00Z');

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 30,
    store_id: 1,
    channel: 'sms',
    segment_id: 4,
    template_name: null,
    template_language: null,
    template_variables: null,
    body: 'Hola {first_name}',
    subject: null,
    status: 'sending',
    recipients_total: 0,
    estimated_cost: 0.015,
    created_by_user_id: 9,
    ...overrides,
  };
}

const eligible = [
  { customer_id: 1, address: '+573001234501', first_name: 'Ana', last_name: 'Gil' },
  { customer_id: 2, address: '+573001234502', first_name: 'Luis', last_name: 'Paz' },
  { customer_id: 5, address: '+573001234505', first_name: 'Eva', last_name: 'Sol' },
];

function setup(options: {
  row?: ReturnType<typeof campaign> | null;
  estimate?: Record<string, unknown>;
  recipients?: typeof eligible;
  env?: Record<string, string>;
  lock?: string | null;
} = {}) {
  const row = options.row === undefined ? campaign() : options.row;
  let nextMessage = 100;
  let nextConversation = 50;
  const prisma = {
    crm_campaigns: {
      findUnique: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crm_conversations: {
      upsert: jest.fn().mockImplementation(() => Promise.resolve({ id: nextConversation++ })),
    },
    crm_messages: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(() => Promise.resolve({ id: nextMessage++ })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const realCampaigns = new CrmCampaignsService(
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  const evaluate = jest.fn().mockResolvedValue({
    store_name: 'Tienda Sol',
    audience: {
      eligible: options.recipients ?? eligible,
      excluded_no_consent: 1,
      excluded_no_address: 0,
      excluded_duplicate: 0,
    },
    estimate: { estimated_cost: 0.015, exceeds_max_recipients: false, ...(options.estimate ?? {}) },
  });
  const campaigns = {
    evaluate,
    contentFromCampaign: (value: never) => realCampaigns.contentFromCampaign(value),
  } as unknown as CrmCampaignsService;
  const outbound = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const env: Record<string, string> = { CRM_OUTBOUND_RATE_PER_STORE: '2', ...(options.env ?? {}) };
  const config = { get: jest.fn((key: string) => env[key]) };
  const unsubscribe = new CrmUnsubscribeService({} as never, config as never, {} as never);
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const redis = {
    set: jest.fn().mockResolvedValue(options.lock === undefined ? 'OK' : options.lock),
    del: jest.fn().mockResolvedValue(1),
  };
  const dispatcher = new CrmCampaignDispatcher(
    prisma as never,
    campaigns,
    outbound as never,
    unsubscribe,
    config as never,
    audit as never,
    redis as never,
  );
  return { dispatcher, prisma, outbound, evaluate, audit, redis };
}

describe('CrmCampaignDispatcher', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('re-evaluates the segment in the campaign store and queues one message per recipient, paced per store', async () => {
    const { dispatcher, prisma, outbound, evaluate } = setup();
    const contexts: unknown[] = [];
    evaluate.mockImplementation(async () => {
      contexts.push(RequestContextService.getContext());
      return {
        store_name: 'Tienda Sol',
        audience: { eligible, excluded_no_consent: 1, excluded_no_address: 0, excluded_duplicate: 0 },
        estimate: { estimated_cost: 0.015, exceeds_max_recipients: false },
      };
    });

    const enqueued = await dispatcher.dispatch(30, NOW);

    expect(enqueued).toBe(3);
    expect(contexts[0]).toMatchObject({ store_id: 1, user_id: 9 });
    expect(prisma.crm_conversations.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id_channel_contact_address: { store_id: 1, channel: 'sms', contact_address: '+573001234501' } },
        create: expect.objectContaining({ store_id: 1, customer_id: 1, status: 'closed' }),
        update: {},
      }),
    );
    expect(prisma.crm_messages.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: 1,
        campaign_id: 30,
        direction: 'outbound',
        channel: 'sms',
        status: 'queued',
        body: 'Hola Ana',
        provider: 'sns_sms',
        sent_by_user_id: 9,
      }),
      select: { id: true },
    });
    expect(prisma.crm_campaigns.updateMany).toHaveBeenCalledWith({
      where: { id: 30, status: 'sending' },
      data: { recipients_total: 3 },
    });
    // Two per second: 0 s, 0 s, 1 s.
    expect(outbound.enqueue.mock.calls).toEqual([
      [100, { delayMs: 0 }],
      [101, { delayMs: 0 }],
      [102, { delayMs: 1000 }],
    ]);
  });

  it('renders WhatsApp template variables and email subject and unsubscribe footer per recipient', async () => {
    const wa = setup({
      row: campaign({ channel: 'whatsapp', body: null, template_name: 'promo', template_language: 'es', template_variables: ['{first_name}', '20%'] }),
      recipients: [eligible[0]],
    });
    await wa.dispatcher.dispatch(30, NOW);
    expect(wa.prisma.crm_messages.create.mock.calls[0][0].data).toMatchObject({
      template_name: 'promo',
      template_variables: ['Ana', '20%'],
      provider: 'meta_cloud',
      body: null,
    });

    const mail = setup({
      row: campaign({ channel: 'email', subject: '{first_name}, esto es para ti', body: 'Promo de {store_name}' }),
      recipients: [{ ...eligible[0], address: 'ana@shop.co' }],
      env: { CRM_PUBLIC_API_URL: 'https://vendix.com/api' },
    });
    await mail.dispatcher.dispatch(30, NOW);
    const data = mail.prisma.crm_messages.create.mock.calls[0][0].data;
    expect(data.subject).toBe('Ana, esto es para ti');
    expect(data.body).toMatch(
      /^Promo de Tienda Sol\n\n—\nSi no quieres recibir más correos de esta tienda, date de baja aquí: https:\/\/vendix\.com\/api\/public\/crm\/unsubscribe\?t=[\w%.-]+$/,
    );
  });

  it('skips recipients that already have their message (crash re-run) and re-enqueues only queued ones', async () => {
    const { dispatcher, prisma, outbound } = setup({ recipients: eligible.slice(0, 2) });
    prisma.crm_messages.findFirst
      .mockResolvedValueOnce({ id: 7, status: 'sent' })
      .mockResolvedValueOnce({ id: 8, status: 'queued' });
    await dispatcher.dispatch(30, NOW);
    expect(prisma.crm_messages.create).not.toHaveBeenCalled();
    expect(outbound.enqueue.mock.calls).toEqual([[8, { delayMs: 0 }]]);
  });

  it('fails the campaign when the cost grew beyond the confirmed margin, without sending anything', async () => {
    const { dispatcher, prisma, outbound, audit } = setup({ estimate: { estimated_cost: 0.02 } });
    await dispatcher.dispatch(30, NOW);
    expect(prisma.crm_campaigns.updateMany).toHaveBeenCalledWith({
      where: { id: 30, status: 'sending' },
      data: expect.objectContaining({ status: 'failed' }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: 'crm_campaign_cost_drift', confirmed_cost: 0.015, estimated_cost: 0.02 }) }),
    );
    expect(prisma.crm_messages.create).not.toHaveBeenCalled();
    expect(outbound.enqueue).not.toHaveBeenCalled();
  });

  it('closes a campaign whose audience opted out entirely since it was confirmed', async () => {
    const { dispatcher, prisma, outbound } = setup({ recipients: [] });
    await dispatcher.dispatch(30, NOW);
    expect(prisma.crm_campaigns.updateMany).toHaveBeenCalledWith({
      where: { id: 30, status: 'sending' },
      data: { status: 'sent', finished_at: NOW },
    });
    expect(outbound.enqueue).not.toHaveBeenCalled();
  });

  it('drops what it created when the campaign was cancelled meanwhile', async () => {
    const { dispatcher, prisma, outbound } = setup();
    prisma.crm_campaigns.updateMany.mockResolvedValueOnce({ count: 0 });
    await dispatcher.dispatch(30, NOW);
    expect(prisma.crm_messages.updateMany).toHaveBeenCalledWith({
      where: { campaign_id: 30, status: 'queued' },
      data: expect.objectContaining({ status: 'failed', error_code: 'CAMPAIGN_CANCELLED' }),
    });
    expect(outbound.enqueue).not.toHaveBeenCalled();
  });

  it('does nothing when another worker holds the lock or the campaign is not sending', async () => {
    const locked = setup({ lock: null });
    await expect(locked.dispatcher.dispatch(30, NOW)).resolves.toBe(0);
    expect(locked.evaluate).not.toHaveBeenCalled();

    const done = setup({ row: campaign({ status: 'cancelled' }) });
    await expect(done.dispatcher.dispatch(30, NOW)).resolves.toBe(0);
    expect(done.evaluate).not.toHaveBeenCalled();
    expect(done.redis.del).toHaveBeenCalled();
  });

  it('fails a campaign whose segment was deleted', async () => {
    const { dispatcher, prisma, evaluate } = setup({ row: campaign({ segment_id: null }) });
    await dispatcher.dispatch(30, NOW);
    expect(evaluate).not.toHaveBeenCalled();
    expect(prisma.crm_campaigns.updateMany).toHaveBeenCalledWith({
      where: { id: 30, status: 'sending' },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('starts due scheduled campaigns and closes campaigns with nothing queued', async () => {
    const { dispatcher, prisma } = setup({ row: null });
    prisma.crm_campaigns.findMany
      .mockResolvedValueOnce([{ id: 31 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 32 }]);
    prisma.crm_messages.groupBy.mockResolvedValue([
      { status: 'read', _count: { _all: 2 } },
      { status: 'failed', _count: { _all: 1 } },
    ]);

    await dispatcher.run(NOW);

    expect(prisma.crm_campaigns.updateMany).toHaveBeenCalledWith({
      where: { id: 31, status: 'scheduled' },
      data: { status: 'sending', started_at: NOW },
    });
    expect(prisma.crm_campaigns.updateMany).toHaveBeenCalledWith({
      where: { id: 32, status: 'sending' },
      data: { recipients_sent: 2, recipients_failed: 1, status: 'sent', finished_at: NOW },
    });
  });
});
