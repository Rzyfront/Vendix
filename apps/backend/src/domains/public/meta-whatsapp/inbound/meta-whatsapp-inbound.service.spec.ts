import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { MetaWhatsappInboundService } from './meta-whatsapp-inbound.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { MessagingService } from '../../../../messaging/messaging.service';
import { S3Service } from '../../../../common/services/s3.service';
import { S3PathHelper } from '../../../../common/helpers/s3-path.helper';

const TOKEN = 'EAAG-plain-token';
const PHONE_NUMBER_ID = '106540352242922';
const FROM = '+573001234567';
const TEXT_WAMID =
  'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=';
const IMAGE_WAMID =
  'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=';
const OUTBOUND_WAMID =
  'wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI3NTVDQTE3N0Q4NzNEQjRCNjgA';

function fixture(name: string) {
  return JSON.parse(
    readFileSync(join(__dirname, '..', '__fixtures__', `${name}.json`), 'utf8'),
  );
}

const channelRow = {
  id: 5,
  store_id: 10,
  channel_type: 'whatsapp',
  provider: 'meta_cloud',
  status: 'connected',
  phone_number_id: PHONE_NUMBER_ID,
  waba_id: '102290129340398',
  access_token_encrypted: 'encrypted',
};

function setup(payloadName: string, overrides: { eventStatus?: string } = {}) {
  const prisma = {
    social_webhook_events: {
      findUnique: jest.fn().mockResolvedValue({
        id: 99,
        provider: 'meta_cloud',
        processing_status: overrides.eventStatus ?? 'received',
        payload: fixture(payloadName),
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    social_channels: { findFirst: jest.fn().mockResolvedValue(channelRow) },
    stores: {
      findUnique: jest.fn().mockResolvedValue({
        id: 10,
        slug: 'tienda',
        organization_id: 7,
        organizations: { id: 7, slug: 'org' },
      }),
    },
    crm_conversations: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 3, last_inbound_at: null, ...data }),
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    crm_messages: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 500 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    store_users: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $queryRaw: jest.fn().mockResolvedValue([{ user_id: 42 }]),
  };
  const messaging = {
    toResolvedChannel: jest.fn().mockResolvedValue({
      id: 5,
      store_id: 10,
      channel_type: 'whatsapp',
      provider: 'meta_cloud',
      phone_number_id: PHONE_NUMBER_ID,
      waba_id: '102290129340398',
      access_token: TOKEN,
      graph_version: 'v23.0',
    }),
  } as unknown as MessagingService;
  const s3 = {
    uploadFile: jest
      .fn()
      .mockImplementation((_buf, key) => Promise.resolve(key)),
  } as unknown as S3Service;
  const events = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new MetaWhatsappInboundService(
    prisma as never,
    messaging,
    s3,
    new S3PathHelper(),
    events as never,
  );
  return { service, prisma, messaging, s3, events };
}

const defaults = { isLastAttempt: false, allowStatusRetry: true };

describe('MetaWhatsappInboundService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    (['log', 'warn', 'error', 'debug'] as const).forEach((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('inbound text message', () => {
    it('creates the conversation linked to the single store customer with that phone', async () => {
      const { service, prisma } = setup('message-text');
      const runSpy = jest.spyOn(RequestContextService, 'runIsolated');

      const outcome = await service.processEvent(99, defaults);

      expect(outcome).toMatchObject({
        status: 'processed',
        messages_created: 1,
      });
      expect(runSpy.mock.calls[0][0]).toMatchObject({
        store_id: 10,
        is_super_admin: false,
      });
      expect(prisma.social_channels.findFirst).toHaveBeenCalledWith({
        where: {
          provider: 'meta_cloud',
          channel_type: 'whatsapp',
          phone_number_id: PHONE_NUMBER_ID,
          status: { in: ['connected', 'error'] },
        },
        orderBy: [
          { connected_at: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
      });
      expect(prisma.crm_conversations.create).toHaveBeenCalledWith({
        data: {
          store_id: 10,
          social_channel_id: 5,
          channel: 'whatsapp',
          contact_address: FROM,
          customer_id: 42,
          status: 'open',
        },
      });

      const sentAt = new Date(1761900000 * 1000);
      expect(prisma.crm_messages.create).toHaveBeenCalledWith({
        data: {
          store_id: 10,
          conversation_id: 3,
          direction: 'inbound',
          channel: 'whatsapp',
          status: 'received',
          body: 'Hola, ¿tienen envío a Medellín?',
          media: undefined,
          provider: 'meta_cloud',
          provider_message_id: TEXT_WAMID,
          webhook_event_id: 99,
          sent_at: sentAt,
          created_at: sentAt,
        },
      });
      expect(prisma.crm_conversations.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: {
          last_message_at: sentAt,
          last_inbound_at: sentAt,
          unread_count: { increment: 1 },
          status: 'open',
          closed_at: null,
          social_channel_id: 5,
        },
      });
      expect(prisma.store_users.updateMany).toHaveBeenCalledWith({
        where: { store_id: 10, user_id: 42 },
        data: { crm_last_contact_at: sentAt },
      });
      expect(prisma.social_webhook_events.update).toHaveBeenCalledWith({
        where: { id: 99 },
        data: {
          processing_status: 'processed',
          processed_at: expect.any(Date),
          error: null,
        },
      });
    });

    it('publishes the new inbound message to the inbox stream', async () => {
      const { service, events } = setup('message-text');

      await service.processEvent(99, defaults);

      expect(events.publish).toHaveBeenCalledWith({
        type: 'crm.message',
        store_id: 10,
        conversation_id: 3,
        assigned_user_id: null,
        message_id: 500,
        status: 'received',
        direction: 'inbound',
      });
    });

    it('does not publish a re-delivered message', async () => {
      const { service, prisma, events } = setup('message-text');
      prisma.crm_messages.findUnique.mockResolvedValue({ id: 500 });

      await service.processEvent(99, defaults);

      expect(events.publish).not.toHaveBeenCalled();
    });

    it('links by E.164 digits and by national number without guessing', async () => {
      const { service, prisma } = setup('message-text');

      await service.processEvent(99, defaults);

      const sql = prisma.$queryRaw.mock.calls[0][0];
      expect(sql.values).toEqual(expect.arrayContaining([10, '573001234567']));
      expect(sql.sql).toContain('store_users');
      expect(sql.sql).toContain("regexp_replace(u.phone, '\\D', '', 'g')");
    });

    it('leaves the conversation unlinked when several customers share the phone', async () => {
      const { service, prisma } = setup('message-text');
      prisma.$queryRaw.mockResolvedValue([{ user_id: 42 }, { user_id: 43 }]);

      await service.processEvent(99, defaults);

      expect(
        prisma.crm_conversations.create.mock.calls[0][0].data.customer_id,
      ).toBeNull();
      expect(prisma.store_users.updateMany).not.toHaveBeenCalled();
    });

    it('is idempotent by provider_message_id when Meta re-delivers', async () => {
      const { service, prisma } = setup('message-text');
      prisma.crm_messages.findUnique.mockResolvedValue({ id: 500 });

      const outcome = await service.processEvent(99, defaults);

      expect(prisma.crm_messages.findUnique).toHaveBeenCalledWith({
        where: {
          provider_provider_message_id: {
            provider: 'meta_cloud',
            provider_message_id: TEXT_WAMID,
          },
        },
      });
      expect(prisma.crm_messages.create).not.toHaveBeenCalled();
      expect(prisma.crm_conversations.update).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({
        status: 'processed',
        messages_created: 0,
      });
    });

    it('treats a concurrent duplicate (P2002) as already processed', async () => {
      const { service, prisma } = setup('message-text');
      prisma.crm_messages.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expect(service.processEvent(99, defaults)).resolves.toMatchObject({
        status: 'processed',
        messages_created: 0,
      });
      expect(prisma.crm_conversations.update).not.toHaveBeenCalled();
    });

    it('reopens an existing closed conversation and keeps the latest inbound time', async () => {
      const { service, prisma } = setup('message-text');
      const later = new Date(1761999999 * 1000);
      prisma.crm_conversations.findUnique.mockResolvedValue({
        id: 3,
        customer_id: 42,
        status: 'closed',
        last_inbound_at: later,
        last_message_at: later,
      });

      await service.processEvent(99, defaults);

      expect(prisma.crm_conversations.create).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(
        prisma.crm_conversations.update.mock.calls[0][0].data,
      ).toMatchObject({
        last_inbound_at: later,
        last_message_at: later,
        status: 'open',
        closed_at: null,
      });
    });
  });

  describe('inbound media', () => {
    function mockMediaDownload() {
      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1003383421387256',
            mime_type: 'image/jpeg',
            file_size: 3,
            id: '1003383421387256',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-length': '3' }),
          arrayBuffer: jest
            .fn()
            .mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
        });
    }

    it('downloads the media with the channel token and stores the S3 key', async () => {
      const { service, prisma, s3 } = setup('message-image');
      mockMediaDownload();

      await service.processEvent(99, defaults);

      const [metaUrl, metaInit] = fetchSpy.mock.calls[0];
      expect(metaUrl).toBe('https://graph.facebook.com/v23.0/1003383421387256');
      expect(metaInit.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(fetchSpy.mock.calls[1][1].headers.Authorization).toBe(
        `Bearer ${TOKEN}`,
      );

      const expectedKey =
        'organizations/org-7/stores/tienda-10/crm/whatsapp-media/1003383421387256.jpg';
      expect(s3.uploadFile).toHaveBeenCalledWith(
        Buffer.from([1, 2, 3]),
        expectedKey,
        'image/jpeg',
      );
      expect(prisma.crm_messages.create.mock.calls[0][0].data).toMatchObject({
        body: 'Este es el modelo',
        provider_message_id: IMAGE_WAMID,
        media: [
          {
            type: 'image',
            media_id: '1003383421387256',
            mime: 'image/jpeg',
            s3_key: expectedKey,
          },
        ],
      });
    });

    it('retries the job when the download fails before the last attempt', async () => {
      const { service, prisma } = setup('message-image');
      fetchSpy.mockResolvedValue({ ok: false, status: 500, json: jest.fn() });

      await expect(service.processEvent(99, defaults)).rejects.toThrow(
        /media 1003383421387256/,
      );
      expect(prisma.crm_messages.create).not.toHaveBeenCalled();
    });

    it('keeps the message without the file on the last attempt', async () => {
      const { service, prisma } = setup('message-image');
      fetchSpy.mockResolvedValue({ ok: false, status: 500, json: jest.fn() });

      await service.processEvent(99, { ...defaults, isLastAttempt: true });

      expect(prisma.crm_messages.create.mock.calls[0][0].data.media).toEqual([
        {
          type: 'image',
          media_id: '1003383421387256',
          mime: 'image/jpeg',
          error: 'download_failed',
        },
      ]);
    });
  });

  describe('delivery statuses', () => {
    it('advances an outbound message to read', async () => {
      const { service, prisma } = setup('status-read');
      prisma.crm_messages.findUnique.mockResolvedValue({
        id: 700,
        store_id: 10,
        status: 'sent',
      });

      const outcome = await service.processEvent(99, defaults);

      expect(prisma.crm_messages.updateMany).toHaveBeenCalledWith({
        where: { id: 700, status: { in: ['queued', 'sent', 'delivered'] } },
        data: { status: 'read', read_at: new Date(1761900120 * 1000) },
      });
      expect(outcome).toMatchObject({ statuses_applied: 1 });
    });

    it('publishes the applied status with the conversation assignee', async () => {
      const { service, prisma, events } = setup('status-read');
      prisma.crm_messages.findUnique.mockResolvedValue({
        id: 700,
        store_id: 10,
        conversation_id: 3,
        status: 'sent',
      });
      prisma.crm_conversations.findUnique.mockResolvedValue({
        assigned_user_id: 8,
      });

      await service.processEvent(99, defaults);

      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'crm.message',
          store_id: 10,
          conversation_id: 3,
          assigned_user_id: 8,
          message_id: 700,
          status: 'read',
        }),
      );
    });

    it('still applies the status when the stream lookup fails', async () => {
      const { service, prisma, events } = setup('status-read');
      prisma.crm_messages.findUnique.mockResolvedValue({
        id: 700,
        store_id: 10,
        conversation_id: 3,
        status: 'sent',
      });
      prisma.crm_conversations.findUnique.mockRejectedValue(
        new Error('db down'),
      );

      const outcome = await service.processEvent(99, defaults);

      expect(outcome).toMatchObject({ statuses_applied: 1 });
      expect(events.publish).not.toHaveBeenCalled();
    });

    it.each([
      ['read', 'status-read'],
      ['failed', 'status-read'],
      ['read', 'status-failed-131047'],
      ['failed', 'status-failed-131047'],
    ])('never moves a %s message with %s', async (current, payload) => {
      const { service, prisma } = setup(payload);
      prisma.crm_messages.findUnique.mockResolvedValue({
        id: 700,
        store_id: 10,
        status: current,
      });

      await service.processEvent(99, defaults);

      expect(prisma.crm_messages.updateMany).not.toHaveBeenCalled();
    });

    it('marks failed with the normalized code and the Meta code', async () => {
      const { service, prisma } = setup('status-failed-131047');
      prisma.crm_messages.findUnique.mockResolvedValue({
        id: 700,
        store_id: 10,
        status: 'sent',
      });

      await service.processEvent(99, defaults);

      expect(prisma.crm_messages.findUnique).toHaveBeenCalledWith({
        where: {
          provider_provider_message_id: {
            provider: 'meta_cloud',
            provider_message_id: OUTBOUND_WAMID,
          },
        },
      });
      expect(prisma.crm_messages.updateMany).toHaveBeenCalledWith({
        where: { id: 700, status: { in: ['queued', 'sent'] } },
        data: {
          status: 'failed',
          failed_at: new Date(1761900180 * 1000),
          error_code: 'WINDOW_CLOSED',
          error_message:
            '[131047] Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
        },
      });
    });

    it('ignores a status whose message belongs to another store', async () => {
      const { service, prisma } = setup('status-read');
      prisma.crm_messages.findUnique.mockResolvedValue({
        id: 700,
        store_id: 11,
        status: 'sent',
      });

      await service.processEvent(99, defaults);

      expect(prisma.crm_messages.updateMany).not.toHaveBeenCalled();
    });

    it('asks for a retry while the outbound row has not stored its wamid yet', async () => {
      const { service, prisma } = setup('status-read');

      const outcome = await service.processEvent(99, defaults);

      expect(outcome).toMatchObject({ status: 'retry', statuses_missing: 1 });
      expect(prisma.social_webhook_events.update).not.toHaveBeenCalled();
    });

    it('settles an unknown status once retries are spent', async () => {
      const { service, prisma } = setup('status-read');

      const outcome = await service.processEvent(99, {
        ...defaults,
        allowStatusRetry: false,
      });

      expect(outcome).toMatchObject({
        status: 'processed',
        statuses_missing: 1,
      });
      expect(prisma.social_webhook_events.update).toHaveBeenCalled();
    });
  });

  describe('event lifecycle', () => {
    it('skips an event that was already processed', async () => {
      const { service, prisma } = setup('message-text', {
        eventStatus: 'processed',
      });

      await expect(service.processEvent(99, defaults)).resolves.toMatchObject({
        status: 'skipped',
      });
      expect(prisma.social_channels.findFirst).not.toHaveBeenCalled();
    });

    it('never routes to a store that disconnected the number', async () => {
      const { service, prisma } = setup('message-text');
      const disconnected = {
        ...channelRow,
        id: 4,
        store_id: 9,
        status: 'disconnected',
      };
      const current = {
        ...channelRow,
        id: 5,
        store_id: 10,
        status: 'connected',
      };
      prisma.social_channels.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(
          [disconnected, current].find((row) =>
            where.status.in.includes(row.status),
          ) ?? null,
        ),
      );

      await service.processEvent(99, defaults);

      expect(
        prisma.crm_conversations.create.mock.calls[0][0].data,
      ).toMatchObject({
        store_id: 10,
        social_channel_id: 5,
      });
    });

    it('ignores an event for a phone number no store owns', async () => {
      const { service, prisma } = setup('message-text');
      prisma.social_channels.findFirst.mockResolvedValue(null);

      await expect(service.processEvent(99, defaults)).resolves.toMatchObject({
        status: 'ignored',
      });
      expect(prisma.crm_messages.create).not.toHaveBeenCalled();
      expect(prisma.social_webhook_events.update).toHaveBeenCalledWith({
        where: { id: 99 },
        data: {
          processing_status: 'ignored',
          processed_at: expect.any(Date),
          error: 'No WhatsApp channel for phone_number_id',
        },
      });
    });

    it('markFailed stores the error on the event', async () => {
      const { service, prisma } = setup('message-text');

      await service.markFailed(99, 'boom');

      expect(prisma.social_webhook_events.update).toHaveBeenCalledWith({
        where: { id: 99 },
        data: { processing_status: 'failed', error: 'boom' },
      });
    });
  });

  describe('marketing opt-out keywords', () => {
    const withBody = (
      prisma: ReturnType<typeof setup>['prisma'],
      body: string,
    ) => {
      const payload = fixture('message-text');
      payload.entry[0].changes[0].value.messages[0].text.body = body;
      prisma.social_webhook_events.findUnique.mockResolvedValue({
        id: 99,
        provider: 'meta_cloud',
        processing_status: 'received',
        payload,
      });
    };

    it('"BAJA" opts the linked customer out of WhatsApp marketing in that store', async () => {
      const { service, prisma } = setup('message-text');
      withBody(prisma, 'Baja');

      await service.processEvent(99, defaults);

      expect(prisma.store_users.updateMany).toHaveBeenCalledWith({
        where: {
          store_id: 10,
          user_id: { in: [42] },
          whatsapp_consent: { not: 'opted_out' },
        },
        data: {
          whatsapp_consent: 'opted_out',
          consent_updated_at: new Date(1761900000 * 1000),
        },
      });
    });

    it('opts out every store customer with that phone when the conversation is unlinked', async () => {
      const { service, prisma } = setup('message-text');
      withBody(prisma, 'STOP');
      // Linking finds two customers (never guessed); the opt-out takes both.
      prisma.$queryRaw.mockResolvedValue([{ user_id: 42 }, { user_id: 43 }]);

      await service.processEvent(99, defaults);

      expect(prisma.crm_conversations.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ customer_id: null }),
      });
      expect(prisma.store_users.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            store_id: 10,
            user_id: { in: [42, 43] },
          }),
          data: expect.objectContaining({ whatsapp_consent: 'opted_out' }),
        }),
      );
    });

    it('a normal message never changes consent', async () => {
      const { service, prisma } = setup('message-text');
      await service.processEvent(99, defaults);
      for (const call of prisma.store_users.updateMany.mock.calls) {
        expect(call[0].data).not.toHaveProperty('whatsapp_consent');
      }
    });
  });

  describe('field dispatch', () => {
    const ECHO_PHONE_ID = '000000000000001';
    const ECHO_WAMID = 'wamid.FAKEECHO0000000000000000000000000001';
    const ECHO_WABA = '000000000000002';

    function setupWith(payload: unknown) {
      const ctx = setup('message-text');
      ctx.prisma.social_webhook_events.findUnique.mockResolvedValue({
        id: 99,
        provider: 'meta_cloud',
        processing_status: 'received',
        payload,
      });
      const channels = ctx.prisma as unknown as {
        social_channels: Record<string, jest.Mock>;
      };
      channels.social_channels.findMany = jest.fn().mockResolvedValue([]);
      channels.social_channels.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });
      return ctx;
    }

    function withValue(name: string, mutate: (value: any) => void) {
      const payload = fixture(name);
      mutate(payload.entry[0].changes[0].value);
      return payload;
    }

    describe('smb_message_echoes', () => {
      it('stores the echo as an outbound sent message without touching unread or the 24h window', async () => {
        const { service, prisma, events } = setupWith(
          fixture('smb-message-echo-text'),
        );
        const sentAt = new Date(1761900100 * 1000);

        const outcome = await service.processEvent(99, defaults);

        expect(outcome).toMatchObject({
          status: 'processed',
          messages_created: 0,
          echoes_created: 1,
          echoes_skipped: 0,
        });
        expect(prisma.social_channels.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ phone_number_id: ECHO_PHONE_ID }),
          }),
        );
        expect(prisma.crm_conversations.create).toHaveBeenCalledWith({
          data: {
            store_id: 10,
            social_channel_id: 5,
            channel: 'whatsapp',
            contact_address: '+15550000002',
            customer_id: 42,
            status: 'open',
          },
        });
        expect(prisma.crm_messages.create).toHaveBeenCalledWith({
          data: {
            store_id: 10,
            conversation_id: 3,
            direction: 'outbound',
            channel: 'whatsapp',
            status: 'sent',
            body: 'Claro, el envío a Medellín llega mañana.',
            media: undefined,
            provider: 'meta_cloud',
            provider_message_id: ECHO_WAMID,
            webhook_event_id: 99,
            sent_at: sentAt,
            created_at: sentAt,
            sent_by_user_id: null,
          },
        });
        expect(prisma.crm_conversations.update).toHaveBeenCalledWith({
          where: { id: 3 },
          data: { last_message_at: sentAt },
        });
        expect(prisma.store_users.updateMany).not.toHaveBeenCalled();
        expect(events.publish).toHaveBeenCalledWith({
          type: 'crm.message',
          store_id: 10,
          conversation_id: 3,
          assigned_user_id: null,
          message_id: 500,
          status: 'sent',
          direction: 'outbound',
        });
        expect(prisma.social_webhook_events.update).toHaveBeenCalledWith({
          where: { id: 99 },
          data: {
            processing_status: 'processed',
            processed_at: expect.any(Date),
            error: null,
          },
        });
      });

      it('keeps the newest last_message_at when the echo is older', async () => {
        const { service, prisma } = setupWith(fixture('smb-message-echo-text'));
        const newer = new Date(1761999999 * 1000);
        prisma.crm_conversations.findUnique.mockResolvedValue({
          id: 3,
          customer_id: 42,
          last_message_at: newer,
          last_inbound_at: newer,
          assigned_user_id: 7,
        });

        await service.processEvent(99, defaults);

        expect(prisma.crm_conversations.update).toHaveBeenCalledWith({
          where: { id: 3 },
          data: { last_message_at: newer },
        });
      });

      it('is idempotent by provider_message_id', async () => {
        const { service, prisma, events } = setupWith(
          fixture('smb-message-echo-text'),
        );
        prisma.crm_messages.findUnique.mockResolvedValue({ id: 1 });

        const outcome = await service.processEvent(99, defaults);

        expect(outcome).toMatchObject({ echoes_created: 0 });
        expect(prisma.crm_messages.findUnique).toHaveBeenCalledWith({
          where: {
            provider_provider_message_id: {
              provider: 'meta_cloud',
              provider_message_id: ECHO_WAMID,
            },
          },
        });
        expect(prisma.crm_messages.create).not.toHaveBeenCalled();
        expect(prisma.crm_conversations.update).not.toHaveBeenCalled();
        expect(events.publish).not.toHaveBeenCalled();
      });

      it('treats a concurrent duplicate (P2002) as already processed', async () => {
        const { service, prisma, events } = setupWith(
          fixture('smb-message-echo-text'),
        );
        prisma.crm_messages.create.mockRejectedValue({ code: 'P2002' });

        const outcome = await service.processEvent(99, defaults);

        expect(outcome).toMatchObject({ echoes_created: 0 });
        expect(prisma.crm_conversations.update).not.toHaveBeenCalled();
        expect(events.publish).not.toHaveBeenCalled();
      });

      it('skips and counts an echo that has no recipient phone', async () => {
        const payload = withValue('smb-message-echo-text', (value) => {
          delete value.message_echoes[0].to;
          value.message_echoes[0].to_user_id = 'BSUID.FAKE.1';
        });
        const { service, prisma, events } = setupWith(payload);

        const outcome = await service.processEvent(99, defaults);

        expect(outcome).toMatchObject({
          status: 'processed',
          echoes_created: 0,
          echoes_skipped: 1,
        });
        expect(prisma.crm_conversations.create).not.toHaveBeenCalled();
        expect(prisma.crm_messages.create).not.toHaveBeenCalled();
        expect(events.publish).not.toHaveBeenCalled();
      });

      it('parses media echoes with the same media pipeline as inbound', async () => {
        const payload = withValue('smb-message-echo-text', (value) => {
          value.message_echoes[0] = {
            ...value.message_echoes[0],
            type: 'image',
            text: undefined,
            image: {
              id: 'MEDIA-ECHO-1',
              mime_type: 'image/jpeg',
              caption: 'Foto',
            },
          };
        });
        const { service, prisma } = setupWith(payload);
        fetchSpy
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              url: 'https://lookaside.example/echo-media',
              mime_type: 'image/jpeg',
              file_size: 10,
            }),
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(10),
          } as Response);

        await service.processEvent(99, defaults);

        const data = prisma.crm_messages.create.mock.calls[0][0].data;
        expect(data.direction).toBe('outbound');
        expect(data.body).toBe('Foto');
        expect(data.media).toEqual([
          expect.objectContaining({
            type: 'image',
            media_id: 'MEDIA-ECHO-1',
            s3_key: expect.stringContaining('MEDIA-ECHO-1.jpg'),
          }),
        ]);
      });

      it('ignores the event when no store owns the phone number', async () => {
        const { service, prisma } = setupWith(fixture('smb-message-echo-text'));
        prisma.social_channels.findFirst.mockResolvedValue(null);

        await expect(service.processEvent(99, defaults)).resolves.toMatchObject(
          {
            status: 'ignored',
          },
        );
        expect(prisma.crm_messages.create).not.toHaveBeenCalled();
      });
    });

    describe('account_update', () => {
      const connectedRow = {
        id: 5,
        store_id: 10,
        status: 'connected',
        metadata: { keep: true },
      };

      it('disconnects every connected channel of the WABA with the user-initiated text', async () => {
        const { service, prisma } = setupWith(
          fixture('account-update-partner-removed'),
        );
        prisma.social_channels.findMany.mockResolvedValue([
          connectedRow,
          { ...connectedRow, id: 6, store_id: 11, metadata: null },
        ]);

        const outcome = await service.processEvent(99, defaults);

        expect(outcome).toMatchObject({
          status: 'processed',
          channels_disconnected: 2,
        });
        expect(prisma.social_channels.findFirst).not.toHaveBeenCalled();
        expect(prisma.social_channels.findMany).toHaveBeenCalledWith({
          where: {
            provider: 'meta_cloud',
            channel_type: 'whatsapp',
            waba_id: ECHO_WABA,
            status: { not: 'disconnected' },
          },
          select: { id: true, store_id: true, metadata: true },
        });
        expect(prisma.social_channels.updateMany).toHaveBeenCalledTimes(2);
        const [first] = prisma.social_channels.updateMany.mock.calls;
        expect(first[0].where).toEqual({
          id: 5,
          provider: 'meta_cloud',
          channel_type: 'whatsapp',
          status: { not: 'disconnected' },
        });
        expect(first[0].data).toMatchObject({
          status: 'disconnected',
          access_token_encrypted: null,
          last_error: 'Desconectaste Vendix desde la app WhatsApp Business.',
          disconnected_at: expect.any(Date),
          metadata: {
            keep: true,
            disconnected_at: expect.any(String),
            disconnection: {
              event: 'PARTNER_REMOVED',
              reason: 'ACCOUNT_DISCONNECTED',
              initiated_by: 'USER',
              at: expect.any(String),
            },
          },
        });
        expect(prisma.social_webhook_events.update).toHaveBeenCalledWith({
          where: { id: 99 },
          data: {
            processing_status: 'processed',
            processed_at: expect.any(Date),
            error: null,
          },
        });
      });

      it('uses the inactivity text for PRIMARY_INACTIVITY', async () => {
        const payload = withValue('account-update-partner-removed', (value) => {
          value.disconnection_info = {
            reason: 'PRIMARY_INACTIVITY',
            initiated_by: 'SYSTEM',
          };
        });
        const { service, prisma } = setupWith(payload);
        prisma.social_channels.findMany.mockResolvedValue([connectedRow]);

        await service.processEvent(99, defaults);

        expect(
          prisma.social_channels.updateMany.mock.calls[0][0].data.last_error,
        ).toBe(
          'Tu WhatsApp Business estuvo inactivo en el celular unos 14 días y se desconectó de Vendix. Vuelve a conectarlo.',
        );
      });

      it('disconnects on ACCOUNT_OFFBOARDED with the generic text', async () => {
        const payload = withValue('account-update-partner-removed', (value) => {
          value.event = 'ACCOUNT_OFFBOARDED';
          delete value.disconnection_info;
        });
        const { service, prisma } = setupWith(payload);
        prisma.social_channels.findMany.mockResolvedValue([connectedRow]);

        await service.processEvent(99, defaults);

        const data = prisma.social_channels.updateMany.mock.calls[0][0].data;
        expect(data.status).toBe('disconnected');
        expect(data.last_error).toBe(
          'Tu número se desconectó de Vendix. Vuelve a conectarlo.',
        );
        expect(data.metadata.disconnection).toMatchObject({
          event: 'ACCOUNT_OFFBOARDED',
        });
      });

      it('only logs ACCOUNT_RECONNECTED', async () => {
        const payload = withValue('account-update-partner-removed', (value) => {
          value.event = 'ACCOUNT_RECONNECTED';
          delete value.disconnection_info;
        });
        const { service, prisma } = setupWith(payload);

        const outcome = await service.processEvent(99, defaults);

        expect(outcome.status).toBe('processed');
        expect(prisma.social_channels.findMany).not.toHaveBeenCalled();
        expect(prisma.social_channels.updateMany).not.toHaveBeenCalled();
      });

      it('ignores other account_update events', async () => {
        const payload = withValue('account-update-partner-removed', (value) => {
          value.event = 'PHONE_NUMBER_NAME_UPDATE';
        });
        const { service, prisma } = setupWith(payload);

        const outcome = await service.processEvent(99, defaults);

        expect(outcome.status).toBe('ignored');
        expect(prisma.social_channels.updateMany).not.toHaveBeenCalled();
      });

      it('ignores the event when waba_info.waba_id is missing', async () => {
        const payload = withValue('account-update-partner-removed', (value) => {
          delete value.waba_info.waba_id;
        });
        const { service, prisma } = setupWith(payload);

        const outcome = await service.processEvent(99, defaults);

        expect(outcome.status).toBe('ignored');
        expect(prisma.social_channels.findMany).not.toHaveBeenCalled();
        expect(prisma.social_channels.updateMany).not.toHaveBeenCalled();
      });

      it('ignores the event when no connected channel owns that WABA', async () => {
        const { service, prisma } = setupWith(
          fixture('account-update-partner-removed'),
        );

        const outcome = await service.processEvent(99, defaults);

        expect(outcome.status).toBe('ignored');
        expect(prisma.social_channels.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('fields without processing', () => {
      const wrap = (field: string, value: unknown) => ({
        object: 'whatsapp_business_account',
        entry: [{ id: ECHO_WABA, changes: [{ field, value }] }],
      });
      const phoneValue = {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: ECHO_PHONE_ID },
      };

      it('leaves history untouched for now', async () => {
        const { service, prisma, events } = setupWith(
          wrap('history', { ...phoneValue, history: [{ threads: [] }] }),
        );

        const outcome = await service.processEvent(99, defaults);

        expect(outcome.status).toBe('ignored');
        expect(prisma.crm_messages.create).not.toHaveBeenCalled();
        expect(prisma.crm_conversations.create).not.toHaveBeenCalled();
        expect(events.publish).not.toHaveBeenCalled();
      });

      it('closes smb_app_state_sync as processed without effects', async () => {
        const { service, prisma, events } = setupWith(
          wrap('smb_app_state_sync', {
            ...phoneValue,
            state_sync: [{ type: 'contact' }],
          }),
        );

        const outcome = await service.processEvent(99, defaults);

        expect(outcome.status).toBe('processed');
        expect(prisma.crm_messages.create).not.toHaveBeenCalled();
        expect(prisma.crm_conversations.create).not.toHaveBeenCalled();
        expect(events.publish).not.toHaveBeenCalled();
        expect(prisma.social_webhook_events.update).toHaveBeenCalledWith({
          where: { id: 99 },
          data: {
            processing_status: 'processed',
            processed_at: expect.any(Date),
            error: null,
          },
        });
      });

      it('ignores unknown fields as before', async () => {
        const { service, prisma } = setupWith(
          wrap('template_category_update', phoneValue),
        );

        const outcome = await service.processEvent(99, defaults);

        expect(outcome.status).toBe('ignored');
        expect(prisma.social_channels.findFirst).not.toHaveBeenCalled();
      });
    });

    it('still handles messages and echoes of the same event', async () => {
      const mixed = fixture('message-text');
      const echo = fixture('smb-message-echo-text');
      mixed.entry[0].changes.push(echo.entry[0].changes[0]);
      const { service, prisma } = setupWith(mixed);

      const outcome = await service.processEvent(99, defaults);

      expect(outcome).toMatchObject({ messages_created: 1, echoes_created: 1 });
      expect(prisma.crm_messages.create).toHaveBeenCalledTimes(2);
    });
  });
});
