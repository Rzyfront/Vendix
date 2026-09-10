import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutIdempotencyService } from './checkout-idempotency.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from '@common/errors';

function p2002() {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    name: 'PrismaClientKnownRequestError',
  });
}

describe('CheckoutIdempotencyService (A.4 CP-facturacion-fixes)', () => {
  let service: CheckoutIdempotencyService;
  let keys: any;

  beforeEach(async () => {
    keys = {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutIdempotencyService,
        {
          provide: StorePrismaService,
          useValue: { checkout_idempotency_keys: keys },
        },
      ],
    }).compile();
    service = module.get<CheckoutIdempotencyService>(CheckoutIdempotencyService);
    jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(4 as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('passes through without a key', async () => {
    await expect(service.begin(undefined)).resolves.toEqual({ replay: false });
    expect(keys.create).not.toHaveBeenCalled();
  });

  it('claims a fresh key, completes it, and replays the stored response', async () => {
    keys.create.mockResolvedValue({ id: 1 });
    keys.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.begin('k-1')).resolves.toEqual({ replay: false });
    await service.complete('k-1', { order_id: 10 });
    expect(keys.updateMany).toHaveBeenCalledWith({
      where: { store_id: 4, idempotency_key: 'k-1', status: 'pending' },
      data: {
        status: 'completed',
        response: { order_id: 10 },
      },
    });

    keys.findUnique.mockResolvedValue({
      id: 1,
      status: 'completed',
      response: { order_id: 10 },
      expires_at: new Date(Date.now() + 3600_000),
    });
    // The completed row exists, so the replay attempt collides on insert.
    keys.create.mockRejectedValueOnce(p2002());
    await expect(service.begin('k-1')).resolves.toEqual({
      replay: true,
      response: { order_id: 10 },
    });
  });

  it('409s a concurrent second submit while pending', async () => {
    keys.create.mockRejectedValue(p2002());
    keys.findUnique.mockResolvedValue({
      id: 1,
      status: 'pending',
      response: null,
      expires_at: new Date(Date.now() + 3600_000),
    });

    await expect(service.begin('k-2')).rejects.toMatchObject({
      errorCode: ErrorCodes.ECOM_CHECKOUT_006.code,
    });
  });

  it('reclaims an expired row instead of replaying it', async () => {
    keys.create
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce({ id: 2 });
    keys.findUnique.mockResolvedValue({
      id: 1,
      status: 'completed',
      response: { order_id: 9 },
      expires_at: new Date(Date.now() - 1000),
    });
    keys.delete.mockResolvedValue({});

    await expect(service.begin('k-3')).resolves.toEqual({ replay: false });
    expect(keys.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('discard releases the key so the client can retry after a failure', async () => {
    keys.deleteMany.mockResolvedValue({ count: 1 });
    await service.discard('k-4');
    expect(keys.deleteMany).toHaveBeenCalledWith({
      where: { store_id: 4, idempotency_key: 'k-4' },
    });
  });
});
