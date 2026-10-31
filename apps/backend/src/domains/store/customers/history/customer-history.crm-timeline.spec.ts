import { Prisma } from '@prisma/client';
import { CustomerHistoryService } from './customer-history.service';

const CUSTOMER = 4;
const SELLER = 2;
const at = (iso: string) => new Date(iso);

function setup() {
  const table = (rows: any[] = []) => ({
    findMany: jest.fn(async ({ take }: any) => rows.slice(0, take)),
  });
  const prisma = {
    orders: table([
      {
        id: 11,
        order_number: 'ORD-11',
        grand_total: new Prisma.Decimal('120000'),
        currency: 'COP',
        state: 'finished',
        channel: 'pos',
        created_at: at('2026-10-20T10:00:00Z'),
      },
    ]),
    payments: table([
      {
        id: 21,
        amount: new Prisma.Decimal('120000'),
        currency: 'COP',
        state: 'succeeded',
        created_at: at('2026-10-20T10:05:00Z'),
        orders: { id: 11, order_number: 'ORD-11' },
      },
    ]),
    quotations: table([
      {
        id: 31,
        quotation_number: 'COT-31',
        grand_total: new Prisma.Decimal('500000'),
        status: 'sent',
        valid_until: null,
        created_at: at('2026-10-25T09:00:00Z'),
      },
    ]),
    bookings: table([
      {
        id: 41,
        booking_number: 'RES-41',
        date: at('2026-10-30T00:00:00Z'),
        start_time: '15:00',
        status: 'confirmed',
        created_at: at('2026-10-18T08:00:00Z'),
        product: { name: 'Corte' },
      },
    ]),
    crm_messages: table([
      {
        id: 51,
        conversation_id: 7,
        direction: 'inbound',
        channel: 'whatsapp',
        status: 'received',
        body: 'Hola, ¿tienen talla M?',
        template_name: null,
        created_at: at('2026-10-29T12:00:00Z'),
        sent_by: null,
      },
    ]),
    crm_tasks: table([
      {
        id: 61,
        title: 'Llamar para cerrar',
        status: 'pending',
        due_at: at('2026-11-02T15:00:00Z'),
        created_at: at('2026-10-28T12:00:00Z'),
        assigned_user: null,
        created_by: { id: 1, first_name: 'Ana', last_name: null },
      },
    ]),
    crm_notes: table([
      {
        id: 71,
        body: 'Prefiere que le escriban en la tarde',
        is_pinned: true,
        created_at: at('2026-10-30T18:00:00Z'),
        created_by: { id: 1, first_name: 'Ana', last_name: null },
      },
    ]),
  };
  const service = new CustomerHistoryService(
    prisma as any,
    {} as any,
    {} as any,
  );
  return { service, prisma };
}

const owner = { user_id: 1, can_see_all: true };
const seller = { user_id: SELLER, can_see_all: false };

describe('CustomerHistoryService.getCrmTimeline', () => {
  it('merges every source newest first with a common item shape', async () => {
    const { service } = setup();
    const result = await service.getCrmTimeline(CUSTOMER, {
      limit: 20,
      viewer: owner,
    });

    expect(result.data.map((item) => item.type)).toEqual([
      'note',
      'message',
      'task',
      'quotation',
      'payment',
      'order',
      'booking',
    ]);
    expect(result.data[5]).toEqual({
      type: 'order',
      at: at('2026-10-20T10:00:00Z'),
      title: 'Pedido ORD-11',
      summary: 'Canal: pos',
      status: 'finished',
      amount: '120000',
      currency: 'COP',
      ref: { kind: 'order', id: 11 },
      actor: null,
    });
    // The inbox opens a conversation: a message points to it.
    expect(result.data[1].ref).toEqual({ kind: 'message', id: 7 });
    expect(result.meta).toEqual({ has_more: false, next_before: null });
  });

  it('the first page puts no created_at filter on any source', async () => {
    const { service, prisma } = setup();
    await service.getCrmTimeline(CUSTOMER, { limit: 20, viewer: owner });
    for (const table of Object.values(prisma)) {
      const where = (table.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where).not.toHaveProperty('created_at');
    }
  });

  it('reads only the requested sources', async () => {
    const { service, prisma } = setup();
    const result = await service.getCrmTimeline(CUSTOMER, {
      types: ['note', 'order'],
      limit: 20,
      viewer: owner,
    });

    expect(result.data.map((item) => item.type)).toEqual(['note', 'order']);
    expect(prisma.payments.findMany).not.toHaveBeenCalled();
    expect(prisma.crm_messages.findMany).not.toHaveBeenCalled();
  });

  it('pages with next_before and filters strictly older rows', async () => {
    const { service, prisma } = setup();
    const first = await service.getCrmTimeline(CUSTOMER, {
      limit: 2,
      viewer: owner,
    });

    expect(first.data.map((item) => item.type)).toEqual(['note', 'message']);
    expect(first.meta).toEqual({
      has_more: true,
      next_before: '2026-10-29T12:00:00.000Z',
    });

    await service.getCrmTimeline(CUSTOMER, {
      limit: 2,
      before: new Date(first.meta.next_before as string),
      viewer: owner,
    });
    expect(prisma.orders.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          customer_id: CUSTOMER,
          created_at: { lt: at('2026-10-29T12:00:00Z') },
        },
        take: 2,
      }),
    );
  });

  it('a seller only reads messages and tasks assigned to them', async () => {
    const { service, prisma } = setup();
    await service.getCrmTimeline(CUSTOMER, { limit: 20, viewer: seller });

    expect(prisma.crm_messages.findMany.mock.calls[0][0].where).toEqual({
      conversation: { customer_id: CUSTOMER, assigned_user_id: SELLER },
    });
    expect(prisma.crm_tasks.findMany.mock.calls[0][0].where).toEqual({
      customer_id: CUSTOMER,
      OR: [{ assigned_user_id: SELLER }, { created_by_user_id: SELLER }],
    });
  });

  it('keeps the booking-only history contract unchanged', async () => {
    const { service, prisma } = setup();
    (prisma.bookings as any).count = jest.fn(async () => 1);
    (prisma.bookings.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 41,
        booking_number: 'RES-41',
        date: at('2026-10-30T00:00:00Z'),
        start_time: '15:00',
        end_time: '16:00',
        status: 'confirmed',
        product: { id: 1, name: 'Corte' },
        provider: null,
        data_collection_submissions: [],
        metadata_snapshot: null,
        consultation_notes: [],
      },
    ]);

    const result = await service.getTimeline(CUSTOMER, 1, 20);

    expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, total_pages: 1 });
    expect(result.data[0]).toMatchObject({ id: 41, booking_number: 'RES-41' });
  });
});
