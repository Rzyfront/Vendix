import { BadRequestException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { DispatchNotesService } from './dispatch-notes.service';

describe('DispatchNotesService.create ubicación del cliente (S4)', () => {
  const addressRow = {
    label: 'Sede Norte',
    address_line1: 'Calle 1 # 2-3',
    address_line2: null,
    city: 'Bogotá',
    state_province: 'Cundinamarca',
    country_code: 'CO',
    postal_code: '110111',
    municipality_code: '11001',
    phone_number: '3000000000',
  };
  let prismaMock: any;
  let service: DispatchNotesService;

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 12, user_id: 5 } as any);
    prismaMock = {
      users: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          first_name: 'Ana',
          last_name: 'Pérez',
          legal_name: null,
          document_number: '900',
        }),
      },
      addresses: { findFirst: jest.fn() },
      dispatch_notes: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 1, ...data }),
        ),
      },
    };
    service = new DispatchNotesService(
      prismaMock,
      { generateNextNumber: jest.fn().mockResolvedValue('REM-1') } as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('con ubicación válida llena el snapshot customer_address', async () => {
    prismaMock.addresses.findFirst.mockResolvedValue(addressRow);

    const result: any = await service.create({
      customer_id: 7,
      customer_address_id: 31,
      items: [],
    } as any);

    expect(prismaMock.addresses.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 31, user_id: 7 } }),
    );
    expect(result.customer_address).toEqual(addressRow);
  });

  it('con ubicación ajena responde 400 y no crea la remisión', async () => {
    prismaMock.addresses.findFirst.mockResolvedValue(null);

    await expect(
      service.create({ customer_id: 7, customer_address_id: 99, items: [] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.dispatch_notes.create).not.toHaveBeenCalled();
  });
});
