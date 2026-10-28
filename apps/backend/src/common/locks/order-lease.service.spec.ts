import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { RequestContextService } from '../context/request-context.service';
import { OrderLeaseService } from './order-lease.service';

/** Minimal in-memory stand-in for the ioredis calls the lease uses. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, _ex: string, _ttl: number, _nx: string) => {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    eval: jest.fn(async (_script: string, _n: number, key: string, token: string) => {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  };
}

describe('OrderLeaseService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let service: OrderLeaseService;

  beforeEach(() => {
    redis = fakeRedis();
    service = new OrderLeaseService(redis as any);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(7);
  });
  afterEach(() => jest.restoreAllMocks());

  it('takes a store+order scoped key with NX and a TTL of 120 s', async () => {
    await service.withLease(42, async () => {
      expect(redis.set).toHaveBeenCalledWith(
        'lease:order:7:42',
        expect.any(String),
        'EX',
        120,
        'NX',
      );
      expect(redis.store.has('lease:order:7:42')).toBe(true);
    });
  });

  it('releases the lease after success', async () => {
    await expect(service.withLease(1, async () => 'ok')).resolves.toBe('ok');
    expect(redis.store.size).toBe(0);
  });

  it('releases the lease after failure and rethrows the original error', async () => {
    await expect(
      service.withLease(1, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(redis.store.size).toBe(0);
  });

  it('throws ORDERS_BULK_LOCKED_001 when the lease is held and never runs fn', async () => {
    redis.store.set('lease:order:7:5', 'someone-else');
    const fn = jest.fn();
    const err: any = await service.withLease(5, fn).catch((e) => e);
    expect(err).toBeInstanceOf(VendixHttpException);
    expect(err.errorCode).toBe(ErrorCodes.ORDERS_BULK_LOCKED_001.code);
    expect(fn).not.toHaveBeenCalled();
    // The foreign lease is untouched.
    expect(redis.store.get('lease:order:7:5')).toBe('someone-else');
  });

  it('does not release a lease that expired and was re-taken by another holder', async () => {
    await service.withLease(9, async () => {
      redis.store.set('lease:order:7:9', 'other-token');
    });
    expect(redis.store.get('lease:order:7:9')).toBe('other-token');
  });

  it('is re-entrant for the same order inside the same async flow', async () => {
    const inner = jest.fn(async () => 'inner');
    await service.withLease(3, async () => service.withLease(3, inner));
    expect(inner).toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.store.size).toBe(0);
  });

  it('acquire returns null when held and a releasable handle otherwise', async () => {
    const handle = await service.acquire(11);
    expect(handle).not.toBeNull();
    expect(await service.acquire(11)).toBeNull();
    await handle!.release();
    expect(redis.store.size).toBe(0);
    expect(await service.acquire(11)).not.toBeNull();
  });

  it('isHeld reflects the key without taking it', async () => {
    expect(await service.isHeld(4)).toBe(false);
    redis.store.set('lease:order:7:4', 'x');
    expect(await service.isHeld(4)).toBe(true);
  });

  it('fails open (runs fn) when Redis is unavailable', async () => {
    redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.withLease(2, async () => 'ran')).resolves.toBe('ran');
  });
});
