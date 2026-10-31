import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CrmOutboundProcessor } from './crm-outbound.processor';
import { CrmOutboundJob } from './crm-outbound.constants';
import { MessagingService } from '../messaging.service';
import { RequestContextService } from '../../common/context/request-context.service';

const LAST_INBOUND = new Date('2026-10-31T10:00:00Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 77,
    store_id: 10,
    conversation_id: 3,
    direction: 'outbound',
    channel: 'whatsapp',
    status: 'queued',
    body: 'Hola',
    template_name: null,
    template_language: null,
    template_variables: null,
    media: null,
    provider: 'meta_cloud',
    conversation: {
      id: 3,
      contact_address: '+573001234567',
      last_inbound_at: LAST_INBOUND,
      assigned_user_id: 5,
    },
    ...overrides,
  };
}

function job(attemptsMade = 0, attempts = 5): Job<CrmOutboundJob> {
  return {
    id: 'crm-outbound-77',
    data: { message_id: 77 },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<CrmOutboundJob>;
}

function setup(message: ReturnType<typeof row> | null = row()) {
  const prisma = {
    crm_messages: {
      findUnique: jest.fn().mockResolvedValue(message),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const messaging = {
    send: jest.fn().mockResolvedValue({
      status: 'sent',
      provider: 'meta_cloud',
      provider_message_id: 'wamid.1',
      retryable: false,
    }),
  } as unknown as MessagingService;
  const events = { publish: jest.fn().mockResolvedValue(undefined) };
  const processor = new CrmOutboundProcessor(
    prisma as never,
    messaging,
    events as never,
  );
  return { processor, prisma, messaging, events };
}

describe('CrmOutboundProcessor', () => {
  it('publishes the sent status to the inbox stream with the assignee', async () => {
    const { processor, events } = setup();

    await processor.process(job());

    expect(events.publish).toHaveBeenCalledWith({
      type: 'crm.message',
      store_id: 10,
      conversation_id: 3,
      assigned_user_id: 5,
      message_id: 77,
      status: 'sent',
      direction: 'outbound',
    });
  });

  it('publishes nothing when the guarded update changed no row', async () => {
    const { processor, prisma, events } = setup();
    prisma.crm_messages.updateMany.mockResolvedValue({ count: 0 });

    await processor.process(job());

    expect(events.publish).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends a queued message inside the store context and marks it sent', async () => {
    const { processor, prisma, messaging } = setup();
    const runSpy = jest.spyOn(RequestContextService, 'runIsolated');

    await processor.process(job());

    expect(runSpy.mock.calls[0][0]).toMatchObject({ store_id: 10 });
    expect(messaging.send).toHaveBeenCalledWith({
      store_id: 10,
      channel: 'whatsapp',
      to: '+573001234567',
      body: 'Hola',
      last_inbound_at: LAST_INBOUND,
      idempotency_key: '77',
    });
    expect(prisma.crm_messages.updateMany).toHaveBeenCalledWith({
      where: { id: 77, status: 'queued' },
      data: expect.objectContaining({
        status: 'sent',
        provider: 'meta_cloud',
        provider_message_id: 'wamid.1',
        sent_at: expect.any(Date),
        error_code: null,
        error_message: null,
      }),
    });
  });

  it('maps a stored template row to the template contract', async () => {
    const { processor, messaging } = setup(
      row({
        body: null,
        template_name: 'order_ready',
        template_language: 'es_CO',
        template_variables: ['Ana', '#1042'],
      }),
    );

    await processor.process(job());

    expect((messaging.send as jest.Mock).mock.calls[0][0].template).toEqual({
      name: 'order_ready',
      language: 'es_CO',
      variables: ['Ana', '#1042'],
    });
  });

  it.each([
    ['already sent', row({ status: 'sent' })],
    ['inbound', row({ direction: 'inbound' })],
    ['internal note', row({ channel: 'internal_note' })],
    ['missing', null],
  ])(
    'skips a message that is %s (idempotent re-delivery)',
    async (_label, message) => {
      const { processor, prisma, messaging } = setup(message);

      await processor.process(job());

      expect(messaging.send).not.toHaveBeenCalled();
      expect(prisma.crm_messages.updateMany).not.toHaveBeenCalled();
    },
  );

  it('marks a non-retryable failure as failed with its code', async () => {
    const { processor, prisma, messaging } = setup();
    (messaging.send as jest.Mock).mockResolvedValue({
      status: 'failed',
      provider: 'meta_cloud',
      error_code: 'WINDOW_CLOSED',
      provider_error_code: '131047',
      error_message: 'Re-engagement message',
      retryable: false,
    });

    await processor.process(job());

    expect(prisma.crm_messages.updateMany).toHaveBeenCalledWith({
      where: { id: 77, status: 'queued' },
      data: expect.objectContaining({
        status: 'failed',
        error_code: 'WINDOW_CLOSED',
        error_message: '[131047] Re-engagement message',
        failed_at: expect.any(Date),
      }),
    });
  });

  it('throws on a retryable failure so BullMQ backs off, keeping the row queued', async () => {
    const { processor, prisma, messaging } = setup();
    (messaging.send as jest.Mock).mockResolvedValue({
      status: 'failed',
      provider: 'meta_cloud',
      error_code: 'RATE_LIMITED',
      provider_error_code: '130429',
      error_message: 'Rate limit hit',
      retryable: true,
    });

    await expect(processor.process(job(1, 5))).rejects.toThrow('RATE_LIMITED');

    expect(prisma.crm_messages.updateMany).toHaveBeenCalledWith({
      where: { id: 77, status: 'queued' },
      data: {
        error_code: 'RATE_LIMITED',
        error_message: '[130429] Rate limit hit',
      },
    });
  });

  it('marks a retryable failure as failed on the last attempt', async () => {
    const { processor, prisma, messaging } = setup();
    (messaging.send as jest.Mock).mockResolvedValue({
      status: 'failed',
      provider: 'meta_cloud',
      error_code: 'RATE_LIMITED',
      error_message: 'Rate limit hit',
      retryable: true,
    });

    await processor.process(job(4, 5));

    expect(prisma.crm_messages.updateMany).toHaveBeenCalledWith({
      where: { id: 77, status: 'queued' },
      data: expect.objectContaining({
        status: 'failed',
        error_code: 'RATE_LIMITED',
      }),
    });
  });
});
