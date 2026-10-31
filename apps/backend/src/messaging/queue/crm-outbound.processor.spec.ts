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
    prisma.crm_messages.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

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
      where: { id: 77, status: 'sending' },
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

  it('SMS: passes the customer for the consent check and stores the cost', async () => {
    const { processor, prisma, messaging } = setup(
      row({
        channel: 'sms',
        provider: 'sns_sms',
        conversation: {
          id: 3,
          contact_address: '+573001234567',
          last_inbound_at: null,
          assigned_user_id: 5,
          customer_id: 33,
        },
      }),
    );
    (messaging.send as jest.Mock).mockResolvedValue({
      status: 'sent',
      provider: 'sns_sms',
      provider_message_id: 'sns-msg-1',
      retryable: false,
      cost_amount: 0.0075,
    });

    await processor.process(job());

    expect(messaging.send).toHaveBeenCalledWith({
      store_id: 10,
      channel: 'sms',
      to: '+573001234567',
      body: 'Hola',
      customer_id: 33,
      idempotency_key: '77',
    });
    expect(prisma.crm_messages.updateMany).toHaveBeenCalledWith({
      where: { id: 77, status: 'sending' },
      data: expect.objectContaining({
        status: 'sent',
        provider: 'sns_sms',
        provider_message_id: 'sns-msg-1',
        cost_amount: 0.0075,
      }),
    });
  });

  it('SMS over the spend cap ends failed with SPEND_LIMIT, without retries', async () => {
    const { processor, prisma, messaging } = setup(row({ channel: 'sms', provider: 'sns_sms' }));
    (messaging.send as jest.Mock).mockResolvedValue({
      status: 'failed',
      provider: 'sns_sms',
      error_code: 'SPEND_LIMIT',
      error_message: 'Monthly SMS spend limit reached',
      retryable: false,
    });

    await expect(processor.process(job())).resolves.toBeUndefined();

    expect(prisma.crm_messages.updateMany).toHaveBeenCalledWith({
      where: { id: 77, status: 'sending' },
      data: expect.objectContaining({
        status: 'failed',
        error_code: 'SPEND_LIMIT',
        error_message: 'Monthly SMS spend limit reached',
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
      where: { id: 77, status: 'sending' },
      data: expect.objectContaining({
        status: 'failed',
        error_code: 'WINDOW_CLOSED',
        error_message: '[131047] Re-engagement message',
        failed_at: expect.any(Date),
      }),
    });
  });

  it('throws on a retryable failure so BullMQ backs off, putting the row back to queued', async () => {
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
      where: { id: 77, status: 'sending' },
      data: {
        status: 'queued',
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
      where: { id: 77, status: 'sending' },
      data: expect.objectContaining({
        status: 'failed',
        error_code: 'RATE_LIMITED',
      }),
    });
  });

  describe('claim before sending (no double send or charge)', () => {
    /** Prisma fake that keeps the row status, so a retry sees what the last attempt left. */
    function statefulSetup(initial: ReturnType<typeof row>) {
      const ctx = setup(initial);
      const state = { ...initial };
      ctx.prisma.crm_messages.findUnique.mockImplementation(async () => ({ ...state }));
      ctx.prisma.crm_messages.updateMany.mockImplementation(
        async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
          if (state.status !== where.status) return { count: 0 };
          Object.assign(state, data);
          return { count: 1 };
        },
      );
      return { ...ctx, state };
    }

    it('claims the row (queued → sending) before calling the provider', async () => {
      const { processor, prisma, messaging } = setup();

      await processor.process(job());

      expect(prisma.crm_messages.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 77, status: 'queued' },
        data: { status: 'sending' },
      });
      expect(prisma.crm_messages.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        (messaging.send as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('does not send when another attempt already claimed the row', async () => {
      const { processor, prisma, messaging, events } = setup();
      prisma.crm_messages.updateMany.mockResolvedValueOnce({ count: 0 });

      await processor.process(job());

      expect(messaging.send).not.toHaveBeenCalled();
      expect(prisma.crm_messages.updateMany).toHaveBeenCalledTimes(1);
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('worker dies between the SMS publish and the update: the retry marks it failed/UNKNOWN without resending', async () => {
      const { processor, prisma, messaging, events, state } = statefulSetup(
        row({ channel: 'sms', provider: 'sns_sms' }),
      );
      (messaging.send as jest.Mock).mockResolvedValue({
        status: 'sent',
        provider: 'sns_sms',
        provider_message_id: 'sns-msg-1',
        retryable: false,
        cost_amount: 0.0075,
      });
      const realUpdate = prisma.crm_messages.updateMany.getMockImplementation()!;
      // The DB connection drops right after SNS accepted (and charged) the SMS.
      prisma.crm_messages.updateMany
        .mockImplementationOnce(realUpdate)
        .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

      await expect(processor.process(job(0))).rejects.toThrow('Connection terminated');
      expect(state.status).toBe('sending');

      // BullMQ retries (or recovers the stalled job).
      await processor.process(job(1));

      expect(messaging.send).toHaveBeenCalledTimes(1);
      expect(state).toMatchObject({ status: 'failed', error_code: 'UNKNOWN' });
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ message_id: 77, status: 'failed' }),
      );
    });

    it('a retryable failure leaves the row queued so the next attempt can claim it again', async () => {
      const { processor, messaging, state } = statefulSetup(row());
      (messaging.send as jest.Mock)
        .mockResolvedValueOnce({
          status: 'failed',
          provider: 'meta_cloud',
          error_code: 'RATE_LIMITED',
          error_message: 'Rate limit hit',
          retryable: true,
        })
        .mockResolvedValueOnce({
          status: 'sent',
          provider: 'meta_cloud',
          provider_message_id: 'wamid.2',
          retryable: false,
        });

      await expect(processor.process(job(0))).rejects.toThrow('RATE_LIMITED');
      expect(state.status).toBe('queued');

      await processor.process(job(1));

      expect(messaging.send).toHaveBeenCalledTimes(2);
      expect(state).toMatchObject({ status: 'sent', provider_message_id: 'wamid.2' });
    });
  });
});
