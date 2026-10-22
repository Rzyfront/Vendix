import { DianNumberingRangeService } from './dian-numbering-range.service';

jest.mock('../providers/dian-direct/dian-numbering-range.parser', () => ({
  parseNumberingRangeResponse: jest.fn(),
}));

const RANGE: any = {
  resolution_number: '18760000001',
  prefix: 'SETP',
  range_from: 1,
  range_to: 100,
  valid_from: '2026-01-01T00:00:00.000Z',
  valid_to: '2027-01-01T00:00:00.000Z',
  resolution_date: '2026-01-01T00:00:00.000Z',
  technical_key: null,
};

describe('DianNumberingRangeService — guarda entre cuentas dentro de la transacción', () => {
  let service: DianNumberingRangeService;
  let tx: any;
  let prisma: any;
  let scoped_create: jest.Mock;
  let scoped_update: jest.Mock;

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn(async () => 1),
      accounting_entities: {
        findFirst: jest.fn(async () => ({
          tax_id: '900123456-7',
          dian_configurations: [],
        })),
        findMany: jest.fn(async () => []),
      },
      invoice_resolutions: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => ({ accounting_entity_id: 3 })),
        create: jest.fn(async () => ({
          id: 11,
          resolution_number: '18760000001',
          prefix: 'SETP',
        })),
        update: jest.fn(async () => ({})),
      },
    };
    scoped_create = jest.fn();
    scoped_update = jest.fn();
    prisma = {
      withoutScope: () => ({
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      }),
      invoice_resolutions: {
        create: scoped_create,
        update: scoped_update,
        findFirst: jest.fn(async () => ({ id: 11 })),
      },
    };
    service = new DianNumberingRangeService(prisma, {} as any, {
      sealForWrite: () => ({}),
    } as any);
  });

  it('createFromDian: toma el advisory lock con el tx y crea con el mismo tx', async () => {
    const res = await (service as any).createFromDian(RANGE, 1, 3, {
      organization_id: 1,
      store_id: 1,
    });

    expect(res.created).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.invoice_resolutions.findMany).toHaveBeenCalled();
    expect(tx.invoice_resolutions.create).toHaveBeenCalledTimes(1);
    expect(scoped_create).not.toHaveBeenCalled();
  });

  it('updateFromDian: la guarda y el update corren con el tx y toman el lock', async () => {
    const local: any = {
      id: 7,
      prefix: 'OLD',
      resolution_number: '18760000001',
      resolution_date: new Date('2026-01-01T00:00:00.000Z'),
      range_from: 1,
      range_to: 50,
      current_number: 0,
      valid_from: new Date('2026-01-01T00:00:00.000Z'),
      valid_to: new Date('2027-01-01T00:00:00.000Z'),
      is_active: true,
      document_type: 'sales_invoice',
      technical_key: null,
      technical_key_encrypted: null,
      technical_key_fingerprint: null,
    };
    const res = await (service as any).updateFromDian(local, RANGE, 1);

    expect(res.applied_fields).toEqual(expect.arrayContaining(['prefix']));
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.invoice_resolutions.update).toHaveBeenCalledTimes(1);
    expect(scoped_update).not.toHaveBeenCalled();
  });
});
