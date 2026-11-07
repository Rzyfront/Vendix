import { CustomersService } from './customers.service';

// The durable outbox write has its own spec (workflow-trigger.fanout.spec.ts).
jest.mock('../workflows/engine/workflow-trigger.outbox', () => ({
  recordTriggerEvent: jest.fn().mockResolvedValue(false),
}));

describe('CustomersService.resolveGuestCustomerForCheckout — phone matching', () => {
  const createService = () => {
    const prisma = {
      withoutScope: () => ({
        $transaction: (cb: (tx: unknown) => unknown) => cb(prisma),
      }),
      stores: { findUnique: jest.fn().mockResolvedValue({ id: 1, organization_id: 3 }) },
      users: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 90, first_name: data.first_name, last_name: data.last_name, email: data.email,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      roles: { findFirst: jest.fn().mockResolvedValue({ id: 7 }) },
    };
    const events = { emit: jest.fn() };
    const service = new CustomersService(prisma as never, events as never);
    jest.spyOn(service as any, 'generateUniqueUsername').mockResolvedValue('ana');
    jest.spyOn(service as any, 'generateUnreachablePassword').mockResolvedValue('hash');
    jest.spyOn(service as any, 'linkCustomerToStore').mockResolvedValue(undefined);
    return { service, prisma };
  };
  const guest = { first_name: 'Ana', email: 'ana@example.com', phone: '300 123 4567' };

  it('match_by_phone false: no busca por teléfono pero guarda el teléfono en el cliente nuevo', async () => {
    const { service, prisma } = createService();
    const result = await service.resolveGuestCustomerForCheckout(1, guest, { match_by_phone: false });
    expect(prisma.users.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.users.findFirst.mock.calls[0][0].where).not.toHaveProperty('phone');
    expect(prisma.users.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: '3001234567' }) }),
    );
    expect(result).toMatchObject({ customer_id: 90, was_created: true });
  });

  it('match_by_phone false: el cliente hallado por correo no recibe el teléfono del invitado', async () => {
    const { service, prisma } = createService();
    prisma.users.findFirst.mockResolvedValueOnce({ id: 5 });
    const result = await service.resolveGuestCustomerForCheckout(1, guest, { match_by_phone: false });
    expect(prisma.users.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { first_name: 'Ana' } });
    expect(result).toMatchObject({ customer_id: 5, was_created: false });
  });

  it('match_by_phone false sin correo: no resuelve a nadie', async () => {
    const { service, prisma } = createService();
    const result = await service.resolveGuestCustomerForCheckout(1, { phone: '3001234567' }, { match_by_phone: false });
    expect(result).toBeNull();
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
  });

  it('por defecto sigue buscando por teléfono y lo actualiza (comportamiento previo)', async () => {
    const { service, prisma } = createService();
    prisma.users.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 6 });
    const result = await service.resolveGuestCustomerForCheckout(1, guest);
    expect(prisma.users.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.users.findFirst.mock.calls[1][0].where).toMatchObject({ phone: '3001234567' });
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 6 }, data: { first_name: 'Ana', phone: '3001234567' },
    });
    expect(result).toMatchObject({ customer_id: 6, was_created: false });
  });
});
