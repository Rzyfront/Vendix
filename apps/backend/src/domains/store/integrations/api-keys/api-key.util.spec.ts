import { createHash } from 'crypto';
import { API_KEY_PREFIX } from './api-key.constants';
import {
  effectivePermissions,
  extractApiKey,
  generateApiKey,
  hashApiKey,
  hashesEqual,
} from './api-key.util';

describe('api-key.util', () => {
  describe('generateApiKey', () => {
    it('has the vdx_live_<prefix>_<base64url 32 bytes> shape', () => {
      const k = generateApiKey();
      expect(k.secret.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(k.prefix).toMatch(/^vdx_live_[0-9a-f]{6}$/);
      expect(k.prefix.length).toBeLessThanOrEqual(16);
      expect(k.secret.startsWith(`${k.prefix}_`)).toBe(true);
      const random = k.secret.slice(k.prefix.length + 1);
      // 32 bytes in base64url (no padding) = 43 chars.
      expect(random).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(random, 'base64url')).toHaveLength(32);
    });

    it('stores only the sha256 of the full secret', () => {
      const k = generateApiKey();
      expect(k.key_hash).toBe(
        createHash('sha256').update(k.secret).digest('hex'),
      );
      expect(k.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(k.key_hash).toBe(hashApiKey(k.secret));
      expect(JSON.stringify({ ...k, secret: undefined })).not.toContain(
        k.secret,
      );
    });

    it('does not repeat across 500 keys (entropy)', () => {
      const secrets = new Set(
        Array.from({ length: 500 }, () => generateApiKey().secret),
      );
      expect(secrets.size).toBe(500);
      const randoms = new Set([...secrets].map((s) => s.slice(-43)));
      expect(randoms.size).toBe(500);
    });
  });

  describe('hashesEqual', () => {
    it('compares digests in constant time and rejects malformed input', () => {
      const h = hashApiKey('a');
      expect(hashesEqual(h, h)).toBe(true);
      expect(hashesEqual(h, hashApiKey('b'))).toBe(false);
      expect(hashesEqual(h, 'zz')).toBe(false);
      expect(hashesEqual('', '')).toBe(false);
    });
  });

  describe('extractApiKey', () => {
    const key = `${API_KEY_PREFIX}abc123_xyz`;
    it('reads Authorization: Bearer and X-Api-Key', () => {
      expect(extractApiKey({ authorization: `Bearer ${key}` })).toBe(key);
      expect(extractApiKey({ authorization: `bearer ${key}` })).toBe(key);
      expect(extractApiKey({ 'x-api-key': key })).toBe(key);
    });
    it('ignores a JWT bearer (a JWT alone never authenticates)', () => {
      expect(
        extractApiKey({ authorization: 'Bearer eyJhbGciOi.eyJzdWIi.sig' }),
      ).toBeNull();
      expect(
        extractApiKey({
          authorization: 'Bearer eyJhbGciOi.x.y',
          'x-api-key': key,
        }),
      ).toBe(key);
    });
    it('rejects missing, wrong scheme, bare prefix and oversize', () => {
      expect(extractApiKey({})).toBeNull();
      expect(extractApiKey(undefined)).toBeNull();
      expect(extractApiKey({ authorization: key })).toBeNull();
      expect(extractApiKey({ authorization: `Basic ${key}` })).toBeNull();
      expect(extractApiKey({ 'x-api-key': API_KEY_PREFIX })).toBeNull();
      expect(
        extractApiKey({ 'x-api-key': `${API_KEY_PREFIX}${'a'.repeat(200)}` }),
      ).toBeNull();
      expect(extractApiKey({ 'x-api-key': ['a'] as any })).toBeNull();
    });
  });

  describe('effectivePermissions (acting user ∩ scopes)', () => {
    const user = [
      'store:workflows:read',
      'store:workflows:start',
      'store:workflows:task',
      'store:workflows:design',
      'store:workflows:manage',
    ];
    it('read scope allows only read', () => {
      expect(effectivePermissions(user, ['workflows:read'])).toEqual([
        'store:workflows:read',
      ]);
    });
    it('write scope allows start + task and never design/manage', () => {
      expect(effectivePermissions(user, ['workflows:write']).sort()).toEqual([
        'store:workflows:start',
        'store:workflows:task',
      ]);
    });
    it('never grants what the acting user lacks', () => {
      expect(
        effectivePermissions(['store:workflows:read'], ['workflows:write']),
      ).toEqual([]);
      expect(
        effectivePermissions(['store:workflows:task'], ['workflows:write']),
      ).toEqual(['store:workflows:task']);
    });
    it('unknown scopes allow nothing', () => {
      expect(
        effectivePermissions(user, ['workflows:admin', 'documents:read']),
      ).toEqual([]);
      expect(effectivePermissions(user, [])).toEqual([]);
    });
  });
});
