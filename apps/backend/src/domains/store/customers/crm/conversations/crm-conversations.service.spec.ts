import { Logger } from '@nestjs/common';
import { firstValueFrom, take, toArray } from 'rxjs';
import { Subject } from 'rxjs';
import { RequestContextService } from '@common/context/request-context.service';
import { CrmConversationsService } from './crm-conversations.service';
import { CrmInboxEvent } from '../../../../../messaging/events/crm-inbox-events.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';

/**
 * In-memory stand-in for `StorePrismaService`. Like the real scope extension
 * (pinned in `store-prisma.crm-inbox.spec.ts`), every read and write is
 * narrowed to the store of the request context, so these tests exercise the
 * service exactly as it runs behind the extension.
 */
const STORE_A = 10;
const STORE_B = 20;
const OWNER_A = 1;
const SELLER_A = 2;
const OTHER_SELLER_A = 3;
const CUSTOMER_A = 4;
const OWNER_B = 9;
const WAITER_A = 6;

const HOUR = 60 * 60 * 1000;

type Row = Record<string, any>;

function matches(row: Row | null | undefined, where: Row | undefined): boolean {
  if (!where) return true;
  if (!row) return false;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return (condition as Row[]).every((w) => matches(row, w));
    if (key === 'OR') return (condition as Row[]).some((w) => matches(row, w));
    const value = row[key];
    if (
      condition === null ||
      typeof condition !== 'object' ||
      condition instanceof Date
    ) {
      return (value ?? null) === condition;
    }
    if ('some' in condition) {
      return (value ?? []).some((item: Row) => matches(item, condition.some));
    }
    if ('not' in condition) return value !== condition.not;
    if ('lt' in condition) return value < condition.lt;
    if ('gt' in condition) return value > condition.gt;
    if ('contains' in condition) {
      return String(value ?? '')
        .toLowerCase()
        .includes(String(condition.contains).toLowerCase());
    }
    return matches(value, condition);
  });
}

function scopedTable(rows: Row[], people: Map<number, Row>) {
  const store = () => RequestContextService.getContext()?.store_id;
  const visible = (where?: Row) =>
    rows.filter((row) => row.store_id === store() && matches(row, where));
  const hydrate = (row: Row) => ({
    ...row,
    customer: people.get(row.customer_id) ?? null,
    assigned_user: people.get(row.assigned_user_id) ?? null,
    sent_by: people.get(row.sent_by_user_id) ?? null,
  });
  const sortById = (list: Row[], orderBy: unknown) => {
    const desc = JSON.stringify(orderBy ?? '').includes('desc');
    return [...list].sort((a, b) => (desc ? b.id - a.id : a.id - b.id));
  };
  return {
    rows,
    findFirst: jest.fn(async ({ where, orderBy }: Row = {}) => {
      const found = sortById(visible(where), orderBy)[0];
      return found ? hydrate(found) : null;
    }),
    findMany: jest.fn(async ({ where, orderBy, skip = 0, take }: Row = {}) =>
      sortById(visible(where), orderBy)
        .slice(skip, take === undefined ? undefined : skip + take)
        .map(hydrate),
    ),
    count: jest.fn(async ({ where }: Row = {}) => visible(where).length),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const targets = visible(where);
      targets.forEach((row) => Object.assign(row, data));
      return { count: targets.length };
    }),
    create: jest.fn(async ({ data }: Row) => {
      const row = {
        id: rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1,
        ...data,
        store_id: store(),
      };
      rows.push(row);
      return hydrate(row);
    }),
  };
}

/** Roles as the seed leaves them: who can open the inbox. */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['store:crm_inbox:read', 'store:crm_inbox:manage', 'store:crm_inbox:assign'],
  employee: ['store:crm_inbox:read', 'store:crm_inbox:manage'],
  cashier: ['store:crm_inbox:read', 'store:crm_inbox:manage'],
  waiter: ['store:orders:read'],
  customer: [],
};

function person(id: number, roles: string[] = ['employee']) {
  return {
    id,
    first_name: `User${id}`,
    last_name: 'Test',
    state: 'active',
    user_roles: roles.map((name) => ({
      roles: {
        name,
        role_permissions: (ROLE_PERMISSIONS[name] ?? []).map((permission) => ({
          permissions: { name: permission, status: 'active' },
        })),
      },
    })),
  };
}

function conversation(overrides: Row): Row {
  return {
    channel: 'whatsapp',
    contact_address: '+573001112233',
    status: 'open',
    customer_id: null,
    assigned_user_id: null,
    social_channel_id: 5,
    unread_count: 0,
    last_message_at: new Date(),
    last_inbound_at: new Date(Date.now() - HOUR),
    snoozed_until: null,
    closed_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

const SMS_CONVERSATION = () =>
  conversation({ id: 6, store_id: STORE_A, channel: 'sms', contact_address: '+573007778899' });

function setup() {
  const people = new Map<number, Row>(
    [
      person(OWNER_A, ['owner']),
      person(SELLER_A),
      person(OTHER_SELLER_A, ['cashier']),
      person(CUSTOMER_A, ['customer']),
      person(WAITER_A, ['waiter']),
      person(OWNER_B, ['owner']),
    ].map((p) => [p.id, p]),
  );
  const conversations = scopedTable(
    [
      conversation({ id: 1, store_id: STORE_A, assigned_user_id: SELLER_A, unread_count: 2 }),
      conversation({ id: 2, store_id: STORE_A, contact_address: '+573004445566' }),
      conversation({ id: 3, store_id: STORE_A, assigned_user_id: OTHER_SELLER_A }),
      conversation({
        id: 4,
        store_id: STORE_A,
        status: 'closed',
        closed_at: new Date(),
        last_inbound_at: new Date(Date.now() - 48 * HOUR),
      }),
      conversation({ id: 50, store_id: STORE_B, unread_count: 7 }),
    ],
    people,
  );
  const messages = scopedTable(
    [
      { id: 100, store_id: STORE_A, conversation_id: 1, direction: 'inbound', channel: 'whatsapp', status: 'received', body: 'Hola', media: null, created_at: new Date() },
      { id: 101, store_id: STORE_A, conversation_id: 1, direction: 'inbound', channel: 'whatsapp', status: 'received', body: null, media: [{ type: 'image', s3_key: 'org/store/crm/a.jpg' }], created_at: new Date() },
      { id: 102, store_id: STORE_A, conversation_id: 1, direction: 'outbound', channel: 'internal_note', status: 'sent', body: 'nota', media: null, created_at: new Date() },
      { id: 900, store_id: STORE_B, conversation_id: 50, direction: 'inbound', channel: 'whatsapp', status: 'received', body: 'secreto de B', media: null, created_at: new Date() },
    ],
    people,
  );
  const staffRows = [
    { id: 1, store_id: STORE_A, user_id: OWNER_A },
    { id: 2, store_id: STORE_A, user_id: SELLER_A },
    { id: 3, store_id: STORE_A, user_id: OTHER_SELLER_A },
    { id: 4, store_id: STORE_A, user_id: CUSTOMER_A },
    { id: 6, store_id: STORE_A, user_id: WAITER_A },
    { id: 5, store_id: STORE_B, user_id: OWNER_B },
  ];
  const storeUsers = scopedTable(
    staffRows.map((row) => ({ ...row, user: people.get(row.user_id) })),
    people,
  );
  const prisma = {
    crm_conversations: conversations,
    crm_messages: messages,
    store_users: storeUsers,
  };

  const messaging = {
    isWindowOpen: jest.fn(
      (at: Date | null) => !!at && Date.now() - new Date(at).getTime() < 24 * HOUR,
    ),
  };
  const outbound = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const live = new Subject<CrmInboxEvent>();
  const events = {
    publish: jest.fn().mockResolvedValue(undefined),
    stream: jest.fn((storeId: number) => live.asObservable()),
  };
  const s3 = {
    signUrl: jest.fn(async (key: string) => `https://signed.example/${key}`),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const smsSpend = { assertAvailable: jest.fn().mockResolvedValue(undefined) };
  const redisStore = new Map<string, string>();
  const redis = {
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    del: jest.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
  };

  const service = new CrmConversationsService(
    prisma as never,
    messaging as never,
    outbound as never,
    events as never,
    s3 as never,
    audit as never,
    redis as never,
    smsSpend as never,
  );
  return { service, prisma, outbound, events, live, redis, redisStore, audit, smsSpend };
}

/** Owner and admin carry `assign`; seller (employee) and cashier do not. */
function as(
  user: 'ownerA' | 'sellerA' | 'ownerB',
  extra: Record<string, unknown> = {},
) {
  const contexts = {
    ownerA: {
      store_id: STORE_A,
      user_id: OWNER_A,
      permissions: ['store:crm_inbox:read', 'store:crm_inbox:manage', 'store:crm_inbox:assign'],
    },
    sellerA: {
      store_id: STORE_A,
      user_id: SELLER_A,
      permissions: ['store:crm_inbox:read', 'store:crm_inbox:manage'],
    },
    ownerB: {
      store_id: STORE_B,
      user_id: OWNER_B,
      permissions: ['store:crm_inbox:read', 'store:crm_inbox:manage', 'store:crm_inbox:assign'],
    },
  };
  jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
    is_super_admin: false,
    is_owner: false,
    ...contexts[user],
    ...extra,
  } as never);
}

const NOT_FOUND = { errorCode: 'CRM_INBOX_001' };

describe('CrmConversationsService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('aislamiento entre tiendas (A/B por endpoint)', () => {
    it('list: la tienda B solo ve sus conversaciones', async () => {
      const { service } = setup();
      as('ownerB');
      const result = await service.list({});
      expect(result.data.map((c) => c.id)).toEqual([50]);
      expect(result.total).toBe(1);
    });

    it('list: la tienda A no ve la conversación de B ni buscando su texto', async () => {
      const { service } = setup();
      as('ownerA');
      const result = await service.list({ q: '+57300' });
      expect(result.data.map((c) => c.id)).not.toContain(50);
    });

    it('stats: cuenta solo la tienda de la petición', async () => {
      const { service } = setup();
      as('ownerB');
      await expect(service.stats()).resolves.toEqual({
        open: 1,
        unassigned: 1,
        mine: 0,
        unread: 1,
      });
    });

    it.each([
      ['findOne', (s: CrmConversationsService) => s.findOne(1)],
      ['messages', (s: CrmConversationsService) => s.messages(1, {})],
      ['send', (s: CrmConversationsService) => s.send(1, { body: 'hola', client_request_id: 'req-00000001' })],
      ['addNote', (s: CrmConversationsService) => s.addNote(1, 'nota')],
      ['markRead', (s: CrmConversationsService) => s.markRead(1)],
      ['close', (s: CrmConversationsService) => s.close(1)],
      ['reopen', (s: CrmConversationsService) => s.reopen(4)],
      ['assign', (s: CrmConversationsService) => s.assign(1, OWNER_B)],
    ])('%s: la tienda B recibe 404 sobre una conversación de A', async (_name, call) => {
      const { service, prisma, outbound, events } = setup();
      const before = JSON.stringify(prisma.crm_conversations.rows);
      as('ownerB');

      await expect(call(service)).rejects.toMatchObject(NOT_FOUND);

      expect(JSON.stringify(prisma.crm_conversations.rows)).toBe(before);
      expect(prisma.crm_messages.rows).toHaveLength(4);
      expect(outbound.enqueue).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('messages: la tienda A no recibe mensajes de B aunque pida su conversación', async () => {
      const { service } = setup();
      as('ownerA');
      await expect(service.messages(50, {})).rejects.toMatchObject(NOT_FOUND);
    });

    it('stream: un evento de la tienda B nunca llega a la tienda A', async () => {
      const { service, live, events } = setup();
      as('ownerA');
      const received = firstValueFrom(service.stream().pipe(take(1), toArray()));
      live.next({ type: 'crm.message', store_id: STORE_B, conversation_id: 50, assigned_user_id: null, at: '' });
      live.next({ type: 'crm.message', store_id: STORE_A, conversation_id: 2, assigned_user_id: null, at: '' });
      await expect(received).resolves.toEqual([
        expect.objectContaining({ store_id: STORE_A, conversation_id: 2 }),
      ]);
      expect(events.stream).toHaveBeenCalledWith(STORE_A);
    });
  });

  describe('vendedor y cajero ven solo lo asignado a ellos', () => {
    it('list: solo las asignadas, aunque pida sin asignar o las de otro', async () => {
      const { service } = setup();
      as('sellerA');
      expect((await service.list({})).data.map((c) => c.id)).toEqual([1]);
      expect((await service.list({ assigned: 'unassigned' })).data).toEqual([]);
      expect((await service.list({ assigned: String(OTHER_SELLER_A) })).data).toEqual([]);
    });

    it('stats: no le cuenta las sin asignar ni las ajenas', async () => {
      const { service } = setup();
      as('sellerA');
      await expect(service.stats()).resolves.toEqual({
        open: 1,
        unassigned: 0,
        mine: 1,
        unread: 1,
      });
    });

    it.each([2, 3])('findOne(%i): 404 sobre una no asignada a él', async (id) => {
      const { service } = setup();
      as('sellerA');
      await expect(service.findOne(id)).rejects.toMatchObject(NOT_FOUND);
    });

    it('no puede responder una conversación de otro vendedor', async () => {
      const { service, outbound } = setup();
      as('sellerA');
      await expect(
        service.send(3, { body: 'hola', client_request_id: 'req-00000002' }),
      ).rejects.toMatchObject(NOT_FOUND);
      expect(outbound.enqueue).not.toHaveBeenCalled();
    });

    it('stream: solo eventos de lo suyo, incluido cuando se lo quitan', async () => {
      const { service, live } = setup();
      as('sellerA');
      const received = firstValueFrom(service.stream().pipe(take(2), toArray()));
      live.next({ type: 'crm.message', store_id: STORE_A, conversation_id: 2, assigned_user_id: null, at: '' });
      live.next({ type: 'crm.message', store_id: STORE_A, conversation_id: 1, assigned_user_id: SELLER_A, at: '' });
      live.next({ type: 'crm.conversation', store_id: STORE_A, conversation_id: 3, assigned_user_id: OTHER_SELLER_A, at: '' });
      live.next({ type: 'crm.conversation', store_id: STORE_A, conversation_id: 1, assigned_user_id: OTHER_SELLER_A, previous_assigned_user_id: SELLER_A, at: '' });
      const events = await received;
      expect(events.map((e) => [e.conversation_id, e.assigned_user_id])).toEqual([
        [1, SELLER_A],
        [1, OTHER_SELLER_A],
      ]);
    });

    it('el dueño de la tienda ve todo aunque no tenga el permiso assign', async () => {
      const { service } = setup();
      as('sellerA', { is_owner: true });
      expect((await service.list({})).total).toBe(4);
    });
  });

  describe('listar y leer', () => {
    it('filtra sin asignar, mías, abiertas y cerradas', async () => {
      const { service } = setup();
      as('ownerA');
      const ids = async (query: Record<string, string>) =>
        (await service.list(query)).data.map((c) => c.id).sort();
      expect(await ids({ assigned: 'unassigned' })).toEqual([2, 4]);
      expect(await ids({ assigned: 'me' })).toEqual([]);
      expect(await ids({ assigned: String(SELLER_A) })).toEqual([1]);
      expect(await ids({ status: 'open' })).toEqual([1, 2, 3]);
      expect(await ids({ status: 'closed' })).toEqual([4]);
    });

    it('la vista previa ignora las notas internas y describe la media', async () => {
      const { service } = setup();
      as('ownerA');
      const { data } = await service.list({ assigned: String(SELLER_A) });
      expect(data[0].last_message_preview).toMatchObject({ text: '[image]', direction: 'inbound' });
    });

    it('detalle con la ventana de 24 h', async () => {
      const { service } = setup();
      as('ownerA');
      const open = await service.findOne(1);
      expect(open.window_open).toBe(true);
      expect(open.window_expires_at!.getTime()).toBeGreaterThan(Date.now());
      expect((await service.findOne(4)).window_open).toBe(false);
    });

    it('mensajes paginados por cursor, del más nuevo al más viejo, con la media firmada', async () => {
      const { service } = setup();
      as('ownerA');
      const first = await service.messages(1, { limit: 2 });
      expect(first.data.map((m) => m.id)).toEqual([102, 101]);
      expect(first.meta).toEqual({ has_more: true, next_before_id: 101 });
      expect(first.data[1].media[0].url).toBe('https://signed.example/org/store/crm/a.jpg');

      const second = await service.messages(1, { limit: 2, before_id: 101 });
      expect(second.data.map((m) => m.id)).toEqual([100]);
      expect(second.meta).toEqual({ has_more: false, next_before_id: null });
    });
  });

  describe('enviar', () => {
    it('texto: crea el mensaje queued, lo encola por la capa messaging y avisa', async () => {
      const { service, prisma, outbound, events } = setup();
      as('ownerA');
      const message = await service.send(1, { body: ' Hola ', client_request_id: 'req-00000003' });

      expect(message).toMatchObject({ status: 'queued', body: 'Hola', direction: 'outbound', channel: 'whatsapp' });
      const row = prisma.crm_messages.rows.find((r) => r.id === message.id)!;
      expect(row).toMatchObject({ store_id: STORE_A, provider: 'meta_cloud', sent_by_user_id: OWNER_A });
      expect(outbound.enqueue).toHaveBeenCalledWith(message.id);
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'crm.message', store_id: STORE_A, conversation_id: 1, message_id: message.id, status: 'queued', assigned_user_id: SELLER_A }),
      );
    });

    it('fuera de la ventana de 24 h solo admite plantilla: CRM_WINDOW_CLOSED', async () => {
      const { service, outbound, prisma } = setup();
      as('ownerA');
      await expect(
        service.send(4, { body: 'hola', client_request_id: 'req-00000004' }),
      ).rejects.toMatchObject({ errorCode: 'CRM_WINDOW_CLOSED' });
      expect(outbound.enqueue).not.toHaveBeenCalled();
      expect(prisma.crm_messages.rows).toHaveLength(4);
    });

    it('plantilla fuera de la ventana: se envía y reabre la conversación cerrada', async () => {
      const { service, prisma, outbound } = setup();
      as('ownerA');
      const message = await service.send(4, {
        template: { name: 'recordatorio', language: 'es', variables: ['Ana'] },
        client_request_id: 'req-00000005',
      });
      const row = prisma.crm_messages.rows.find((r) => r.id === message.id)!;
      expect(row).toMatchObject({ template_name: 'recordatorio', template_language: 'es', template_variables: ['Ana'], body: null });
      expect(outbound.enqueue).toHaveBeenCalledWith(message.id);
      expect(prisma.crm_conversations.rows.find((c) => c.id === 4)).toMatchObject({ status: 'open', closed_at: null });
    });

    it('SMS con el tope del mes agotado: CRM_SMS_SPEND_LIMIT y no se encola', async () => {
      const { service, outbound, prisma, smsSpend } = setup();
      prisma.crm_conversations.rows.push(SMS_CONVERSATION());
      as('ownerA');
      const before = prisma.crm_messages.rows.length;
      smsSpend.assertAvailable.mockRejectedValueOnce(
        new VendixHttpException(ErrorCodes.CRM_SMS_SPEND_LIMIT),
      );
      await expect(
        service.send(6, { body: 'hola', client_request_id: 'req-00000020' }),
      ).rejects.toMatchObject({ errorCode: 'CRM_SMS_SPEND_LIMIT' });
      expect(smsSpend.assertAvailable).toHaveBeenCalledWith(STORE_A);
      expect(outbound.enqueue).not.toHaveBeenCalled();
      expect(prisma.crm_messages.rows).toHaveLength(before);
    });

    it('SMS con tope disponible: queda queued con provider sns_sms', async () => {
      const { service, prisma, outbound, smsSpend } = setup();
      prisma.crm_conversations.rows.push(SMS_CONVERSATION());
      as('ownerA');
      const message = await service.send(6, { body: 'hola', client_request_id: 'req-00000021' });
      const row = prisma.crm_messages.rows.find((r) => r.id === message.id)!;
      expect(row).toMatchObject({ channel: 'sms', provider: 'sns_sms', status: 'queued' });
      expect(outbound.enqueue).toHaveBeenCalledWith(message.id);
      expect(smsSpend.assertAvailable).toHaveBeenCalledWith(STORE_A);
    });

    it('WhatsApp no consulta el tope de SMS', async () => {
      const { service, smsSpend } = setup();
      as('ownerA');
      await service.send(1, { body: 'hola', client_request_id: 'req-00000022' });
      expect(smsSpend.assertAvailable).not.toHaveBeenCalled();
    });

    it('sin texto ni plantilla: CRM_INBOX_005', async () => {
      const { service } = setup();
      as('ownerA');
      await expect(
        service.send(1, { body: '   ', client_request_id: 'req-00000006' }),
      ).rejects.toMatchObject({ errorCode: 'CRM_INBOX_005' });
    });

    it('el mismo client_request_id no envía dos veces', async () => {
      const { service, prisma, outbound } = setup();
      as('ownerA');
      const dto = { body: 'hola', client_request_id: 'req-00000007' };
      const first = await service.send(1, dto);
      const second = await service.send(1, dto);

      expect(second).toMatchObject({ id: first.id, duplicate: true });
      expect(outbound.enqueue).toHaveBeenCalledTimes(1);
      expect(prisma.crm_messages.rows.filter((r) => r.status === 'queued')).toHaveLength(1);
    });

    it('si la cola no acepta el mensaje, queda failed y se puede reintentar', async () => {
      const { service, prisma, outbound, redisStore } = setup();
      as('ownerA');
      outbound.enqueue.mockRejectedValueOnce(new Error('redis down'));
      const dto = { body: 'hola', client_request_id: 'req-00000008' };

      await expect(service.send(1, dto)).rejects.toMatchObject({ errorCode: 'CRM_INBOX_004' });
      const failed = prisma.crm_messages.rows.at(-1)!;
      expect(failed).toMatchObject({ status: 'failed', error_code: 'ENQUEUE_FAILED' });
      expect(redisStore.size).toBe(0);

      await service.send(1, dto);
      expect(outbound.enqueue).toHaveBeenCalledTimes(2);
    });
  });

  describe('envío a medias', () => {
    it('si falla actualizar la conversación, el mensaje creado queda failed y no se encola', async () => {
      const { service, prisma, outbound, redisStore } = setup();
      as('ownerA');
      prisma.crm_conversations.updateMany.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.send(1, { body: 'hola', client_request_id: 'req-00000009' }),
      ).rejects.toMatchObject({ errorCode: 'CRM_INBOX_004' });

      expect(prisma.crm_messages.rows.at(-1)).toMatchObject({ status: 'failed', error_code: 'ENQUEUE_FAILED' });
      expect(prisma.crm_messages.rows.filter((r) => r.status === 'queued')).toHaveLength(0);
      expect(outbound.enqueue).not.toHaveBeenCalled();
      expect(redisStore.size).toBe(0);
    });
  });

  describe('notas, leída, cerrar, reabrir y asignar', () => {
    it('la nota interna se guarda y nunca se encola', async () => {
      const { service, prisma, outbound } = setup();
      as('sellerA');
      const note = await service.addNote(1, 'Llamar mañana');
      expect(note).toMatchObject({ channel: 'internal_note', status: 'sent', body: 'Llamar mañana' });
      expect(prisma.crm_messages.rows.at(-1)).toMatchObject({ provider: 'internal', sent_by_user_id: SELLER_A });
      expect(outbound.enqueue).not.toHaveBeenCalled();
    });

    it('marcar como leída pone los no leídos en 0', async () => {
      const { service, prisma } = setup();
      as('sellerA');
      await expect(service.markRead(1)).resolves.toEqual({ id: 1, unread_count: 0 });
      expect(prisma.crm_conversations.rows[0].unread_count).toBe(0);
    });

    it('cerrar y reabrir', async () => {
      const { service, events } = setup();
      as('ownerA');
      const closed = await service.close(2);
      expect(closed).toMatchObject({ status: 'closed' });
      expect(closed.closed_at).toBeInstanceOf(Date);
      const reopened = await service.reopen(2);
      expect(reopened).toMatchObject({ status: 'open', closed_at: null });
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'crm.conversation', conversation_id: 2, status: 'closed' }),
      );
    });

    it('asignar a personal de la tienda: guarda, audita y avisa al anterior', async () => {
      const { service, prisma, audit, events } = setup();
      as('ownerA');
      const result = await service.assign(1, OTHER_SELLER_A);
      expect(result.assigned_user).toMatchObject({ id: OTHER_SELLER_A });
      expect(prisma.crm_conversations.rows[0].assigned_user_id).toBe(OTHER_SELLER_A);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ resource: 'crm_conversations', resourceId: 1, oldValues: { assigned_user_id: SELLER_A }, newValues: { assigned_user_id: OTHER_SELLER_A } }),
      );
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ assigned_user_id: OTHER_SELLER_A, previous_assigned_user_id: SELLER_A }),
      );
    });

    it('desasignar con null', async () => {
      const { service, prisma } = setup();
      as('ownerA');
      await service.assign(1, null);
      expect(prisma.crm_conversations.rows[0].assigned_user_id).toBeNull();
    });

    it.each([
      ['un cliente', CUSTOMER_A],
      ['personal sin acceso a la bandeja (mesero)', WAITER_A],
      ['personal de otra tienda', OWNER_B],
      ['un usuario inexistente', 999],
    ])('no asigna a %s: CRM_INBOX_002', async (_label, userId) => {
      const { service, prisma } = setup();
      as('ownerA');
      await expect(service.assign(2, userId)).rejects.toMatchObject({ errorCode: 'CRM_INBOX_002' });
      expect(prisma.crm_conversations.rows[1].assigned_user_id).toBeNull();
    });
  });
});
