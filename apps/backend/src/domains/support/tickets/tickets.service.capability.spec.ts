import {
  CAPABILITY_REQUEST_TAG,
  TicketsService,
  capabilityKeyTag,
  capabilityVoteTag,
} from './tickets.service';

/** T5 — one ticket per capability across tenants; other stores vote. */
describe('TicketsService · solicitudes de capacidad', () => {
  function build(existing: any = null) {
    const orgPrisma = {
      organizations: {
        findUnique: jest.fn().mockResolvedValue({ id: 3, slug: 'demo' }),
      },
      support_tickets: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      },
    };
    const globalPrisma = {
      support_tickets: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(async ({ data }: any) => ({
          ...existing,
          tags: [...existing.tags, data.tags.push],
        })),
      },
    };
    const service = new TicketsService(
      orgPrisma as any,
      globalPrisma as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
    );
    return { service, orgPrisma, globalPrisma };
  }

  const INPUT = {
    organizationId: 3,
    storeId: 7,
    userId: 11,
    capabilityKey: 'storefront-cart-button-color',
    title: 'Cambiar el color del botón del carrito',
    description: 'Solicitud de capacidad desde Vex.',
  };

  it('el voto es un hash opaco, estable y distinto por tienda', () => {
    expect(capabilityVoteTag(7)).toMatch(/^capability-vote:[0-9a-f]{16}$/);
    expect(capabilityVoteTag(7)).toBe(capabilityVoteTag(7));
    expect(capabilityVoteTag(7)).not.toBe(capabilityVoteTag(8));
    expect(capabilityVoteTag(7)).not.toContain('store');
  });

  it('primera vez: crea UN ticket con la etiqueta de capacidad y el voto', async () => {
    const { service, orgPrisma, globalPrisma } = build(null);
    const out = await service.recordCapabilityRequest(INPUT);
    expect(globalPrisma.support_tickets.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tags: { has: 'capability:storefront-cart-button-color' },
          status: { notIn: ['RESOLVED', 'CLOSED'] },
        },
      }),
    );
    const data = orgPrisma.support_tickets.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organization_id: 3,
      store_id: 7,
      category: 'SERVICE_REQUEST',
      tags: [
        CAPABILITY_REQUEST_TAG,
        capabilityKeyTag('storefront-cart-button-color'),
        capabilityVoteTag(7),
      ],
    });
    expect(out).toMatchObject({
      outcome: 'created',
      own: true,
      ticket_number: 'TKT30001',
      votes: 1,
    });
  });

  it('otra tienda (otra organización): suma voto, no crea y no ve el número', async () => {
    const existing = {
      id: 1,
      ticket_number: 'TKT30001',
      organization_id: 3,
      tags: [CAPABILITY_REQUEST_TAG, capabilityKeyTag(INPUT.capabilityKey), capabilityVoteTag(7)],
    };
    const { service, orgPrisma, globalPrisma } = build(existing);
    const out = await service.recordCapabilityRequest({
      ...INPUT,
      organizationId: 9,
      storeId: 42,
    });
    expect(orgPrisma.support_tickets.create).not.toHaveBeenCalled();
    expect(globalPrisma.support_tickets.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ tags: { push: capabilityVoteTag(42) } }),
      }),
    );
    expect(out).toMatchObject({
      outcome: 'voted',
      own: false,
      ticket_number: null,
      votes: 2,
    });
  });

  it('la misma tienda otra vez: ni ticket ni voto nuevo', async () => {
    const existing = {
      id: 1,
      ticket_number: 'TKT30001',
      organization_id: 3,
      tags: [capabilityKeyTag(INPUT.capabilityKey), capabilityVoteTag(7)],
    };
    const { service, orgPrisma, globalPrisma } = build(existing);
    const out = await service.recordCapabilityRequest(INPUT);
    expect(orgPrisma.support_tickets.create).not.toHaveBeenCalled();
    expect(globalPrisma.support_tickets.update).not.toHaveBeenCalled();
    expect(out).toMatchObject({ outcome: 'already_voted', ticket_number: 'TKT30001' });
  });
});
