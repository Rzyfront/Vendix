import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import {
  canonicalJson,
  ConfirmationMetadata,
  VexiConfirmationService,
} from './vexi-confirmation.service';

describe('VexiConfirmationService G compatibility and nonconsuming inspection', () => {
  const metadata: ConfirmationMetadata = {
    previewHash: 'a'.repeat(64),
    organizationId: 3,
    storeId: 5,
    toolVersion: '1',
  };
  let redis: { set: jest.Mock; eval: jest.Mock };
  let service: VexiConfirmationService;

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };
    service = new VexiConfirmationService(redis as unknown as Redis);
  });

  it('keeps the three-argument issue SET and the existing 300s fingerprint ABI', async () => {
    const args = { body: { z: 5, a: 2 }, method: 'PATCH' };
    const token = await service.issue('write_endpoint', args, 7);
    const fingerprint = createHash('sha256')
      .update(`7|write_endpoint|${canonicalJson(args)}`)
      .digest('hex');
    expect(redis.set).toHaveBeenCalledWith(
      `vexi:confirm:${token}`,
      fingerprint,
      'EX',
      300,
    );
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('issues metadata and token in the same Lua operation without changing fingerprint', async () => {
    const token = await service.issue(
      'set_product',
      { price: 10 },
      7,
      metadata,
    );
    expect(redis.set).not.toHaveBeenCalled();
    const call = redis.eval.mock.calls[0];
    expect(call[0]).toContain("redis.call('SET', KEYS[1]");
    expect(call.slice(1, 4)).toEqual([
      2,
      `vexi:confirm:${token}`,
      `vexi:confirm-meta:${token}`,
    ]);
    expect(call[5]).toBe(canonicalJson(metadata));
    expect(call[6]).toBe(300);
  });

  it('inspects full canonical nested args and TTL without DEL or consuming the token', async () => {
    redis.eval.mockResolvedValue([1, 200, JSON.stringify(metadata)]);
    expect(
      await service.inspect(
        'token',
        'set_product',
        { b: 2, nested: { z: 3, a: 4 } },
        7,
      ),
    ).toEqual({ outcome: 'ok', ttlSeconds: 200, metadata });
    expect(redis.eval.mock.calls[0][0]).toContain("redis.call('TTL'");
    expect(redis.eval.mock.calls[0][0]).not.toContain("redis.call('DEL'");
  });

  it.each([
    [0, 0, ''],
    [1, 0, ''],
    [1, -1, ''],
  ])(
    'fails inspection closed for missing/nonexpiring/expired token %j',
    async (...result) => {
      redis.eval.mockResolvedValue(result);
      expect(await service.inspect('token', 'set_product', {}, 7)).toEqual({
        outcome: 'missing',
        ttlSeconds: 0,
      });
    },
  );

  it('reports mismatch without metadata even when sidecar would be present', async () => {
    redis.eval.mockResolvedValue([-1, 99, JSON.stringify(metadata)]);
    expect(await service.inspect('token', 'set_product', {}, 8)).toEqual({
      outcome: 'mismatch',
      ttlSeconds: 0,
    });
  });

  it.each([
    '',
    '{broken',
    '{}',
    JSON.stringify({ ...metadata, previewHash: 'wrong' }),
    JSON.stringify({ ...metadata, storeId: 0 }),
  ])(
    'keeps legacy click token valid but strips unusable voice metadata %s',
    async (raw) => {
      redis.eval.mockResolvedValue([1, 80, raw]);
      expect(await service.inspect('token', 'set_product', {}, 7)).toEqual({
        outcome: 'ok',
        ttlSeconds: 80,
      });
    },
  );

  it('rejects invalid metadata before writing any token', async () => {
    await expect(
      service.issue('set_product', {}, 7, { ...metadata, toolVersion: '' }),
    ).rejects.toThrow();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('redeem keeps legacy single key compare-and-delete', async () => {
    expect(await service.redeem('token', 'set_product', { price: 5 }, 7)).toBe(
      'ok',
    );
    expect(redis.eval.mock.calls[0].slice(1, 3)).toEqual([
      1,
      'vexi:confirm:token',
    ]);
    expect(redis.eval.mock.calls[0][0]).toContain("redis.call('DEL', KEYS[1])");
  });

  it.each([
    [0, 'missing'],
    [-1, 'mismatch'],
  ])('preserves legacy redeem outcome %s', async (code, expected) => {
    redis.eval.mockResolvedValue(code);
    expect(await service.redeem('token', 'set_product', {}, 7)).toBe(expected);
  });

  it('hashes recursively, drops undefined objects, preserves ordered arrays and nested argument drift', () => {
    expect(canonicalJson({ z: { b: 2, a: 1 }, absent: undefined })).toBe(
      '{"z":{"a":1,"b":2}}',
    );
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(canonicalJson({ body: { price: 5 } })).not.toBe(
      canonicalJson({ body: { price: 500 } }),
    );
  });
});
