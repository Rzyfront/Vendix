import {
  ANALYSIS_LAMBDA_TIMEOUT_MS,
  ANALYSIS_STORE_SLOT_TTL_MS,
  SandboxStoreSlotService,
} from './sandbox-store-slot.service';

function build() {
  const redis = {
    set: jest.fn<Promise<'OK' | null>, any[]>(async () => 'OK'),
    eval: jest.fn<Promise<number>, any[]>(async () => 1),
  };
  return { redis, slots: new SandboxStoreSlotService(redis as never) };
}

describe('SandboxStoreSlotService', () => {
  it('outlives the Lambda timeout with room for dispatch and a cold init', () => {
    expect(ANALYSIS_LAMBDA_TIMEOUT_MS).toBe(30_000);
    expect(ANALYSIS_STORE_SLOT_TTL_MS).toBeGreaterThanOrEqual(
      ANALYSIS_LAMBDA_TIMEOUT_MS + 10_000,
    );
  });

  it('acquires the per-store key atomically with SET NX and the TTL', async () => {
    const { redis, slots } = build();
    await expect(slots.acquire(7, 'run-a')).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'ai:analysis:store-slot:7',
      'run-a',
      'PX',
      ANALYSIS_STORE_SLOT_TTL_MS,
      'NX',
    );
  });

  it('reports a busy store when the key already exists', async () => {
    const { redis, slots } = build();
    redis.set.mockResolvedValue(null);
    await expect(slots.acquire(7, 'run-b')).resolves.toBe(false);
  });

  it('propagates Redis errors on acquire so the caller fails closed', async () => {
    const { redis, slots } = build();
    redis.set.mockRejectedValue(new Error('redis down'));
    await expect(slots.acquire(7, 'run-a')).rejects.toThrow('redis down');
  });

  it('releases only its own token with a compare-and-delete script', async () => {
    const { redis, slots } = build();
    await slots.release(7, 'run-a');
    const [script, keys, key, token] = redis.eval.mock.calls[0];
    expect(script).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
    expect(script).toContain("redis.call('DEL', KEYS[1])");
    expect([keys, key, token]).toEqual([
      1,
      'ai:analysis:store-slot:7',
      'run-a',
    ]);
  });

  it('swallows a release failure: the TTL frees the slot', async () => {
    const { redis, slots } = build();
    redis.eval.mockRejectedValue(new Error('redis down'));
    await expect(slots.release(7, 'run-a')).resolves.toBeUndefined();
  });
});
