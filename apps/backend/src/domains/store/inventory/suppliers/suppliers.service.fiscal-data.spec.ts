import { SuppliersService } from './suppliers.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('SuppliersService fiscal data (document_type, verification_digit, address)', () => {
  const address = {
    address_line1: 'Calle 10 # 5-20',
    city: 'Medellín',
    state_province: 'Antioquia',
    municipality_code: '05001',
  };

  function build(existing: Record<string, unknown> | null = null) {
    const tx = {
      addresses: { create: jest.fn().mockResolvedValue({ id: 77 }) },
      // `recordTriggerEvent` (outbox de flujos) consulta flujos activos en la misma tx.
      workflow_definitions: { findFirst: jest.fn().mockResolvedValue(null) },
      suppliers: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 1, ...data, store_id: 4 }),
          ),
      },
    };
    const scopedAddresses = { create: jest.fn().mockResolvedValue({ id: 88 }) };
    const unscopedAddresses = { update: jest.fn().mockResolvedValue({}) };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      addresses: scopedAddresses,
      suppliers: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
      },
      withoutScope: jest.fn().mockReturnValue({ addresses: unscopedAddresses }),
    };
    const service = new SuppliersService(
      prisma as any,
      { getOperatingScope: jest.fn().mockResolvedValue('STORE') } as any,
      { emit: jest.fn() } as any,
    );
    return { service, prisma, tx, scopedAddresses, unscopedAddresses };
  }

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: 2,
      store_id: 4,
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('create persists document_type, DV and a new address linked by address_id', async () => {
    const { service, tx } = build();
    await service.create({
      name: 'Prov',
      code: 'P1',
      tax_id: '900123456',
      document_type: '31',
      verification_digit: '7',
      address,
    } as any);

    expect(tx.addresses.create).toHaveBeenCalledTimes(1);
    expect(tx.addresses.create.mock.calls[0][0].data).toMatchObject({
      ...address,
      country_code: 'CO',
      organization_id: 2,
      store_id: 4,
    });
    const data = tx.suppliers.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      document_type: '31',
      verification_digit: '7',
      address_id: 77,
    });
    expect(data).not.toHaveProperty('address');
  });

  it('update with an address updates the existing one in place (no duplicate)', async () => {
    const { service, prisma, scopedAddresses, unscopedAddresses } = build({
      id: 1,
      organization_id: 2,
      store_id: 4,
      address_id: 55,
    });
    await service.update(1, {
      document_type: '31',
      verification_digit: '3',
      address,
    } as any);
    await service.update(1, { address } as any);

    expect(unscopedAddresses.update).toHaveBeenCalledTimes(2);
    expect(unscopedAddresses.update.mock.calls[0][0].where).toEqual({
      id: 55,
      organization_id: 2,
    });
    expect(scopedAddresses.create).not.toHaveBeenCalled();
    const first = prisma.suppliers.update.mock.calls[0][0].data;
    expect(first).toMatchObject({ document_type: '31', verification_digit: '3' });
    expect(first).not.toHaveProperty('address');
    expect(first).not.toHaveProperty('address_id');
  });

  it('update with an address on a supplier without one creates it once and links address_id', async () => {
    const { service, prisma, scopedAddresses } = build({
      id: 1,
      organization_id: 2,
      store_id: 4,
      address_id: null,
    });
    await service.update(1, { address } as any);

    expect(scopedAddresses.create).toHaveBeenCalledTimes(1);
    expect(prisma.suppliers.update.mock.calls[0][0].data.address_id).toBe(88);
  });

  it('update without fiscal fields keeps the previous behaviour (data passes through, no address work)', async () => {
    const { service, prisma, scopedAddresses, unscopedAddresses } = build({
      id: 1,
      organization_id: 2,
      store_id: 4,
      address_id: 55,
    });
    await service.update(1, { name: 'Nuevo', phone: '300' } as any);

    expect(prisma.suppliers.update.mock.calls[0][0].data).toEqual({
      name: 'Nuevo',
      phone: '300',
    });
    expect(scopedAddresses.create).not.toHaveBeenCalled();
    expect(unscopedAddresses.update).not.toHaveBeenCalled();
  });
});
