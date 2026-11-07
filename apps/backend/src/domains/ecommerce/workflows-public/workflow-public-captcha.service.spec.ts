import { createHash } from 'crypto';
import { VendixHttpException } from '@common/errors';
import {
  CAPTCHA_DIFFICULTY_BITS,
  CAPTCHA_TTL_MS,
  WorkflowPublicCaptchaService,
  leadingZeroBits,
} from './workflow-public-captcha.service';
import { solveCaptcha } from './workflow-public.testkit';

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode;
  }
}

describe('WorkflowPublicCaptchaService (proof of work)', () => {
  const seen = new Set<string>();
  const redis = {
    set: jest.fn(async (key: string) => {
      if (seen.has(key)) return null;
      seen.add(key);
      return 'OK';
    }),
  };
  const config = (secret?: string) => ({ get: (k: string) => (k === 'JWT_SECRET' ? secret : undefined) });
  let service: WorkflowPublicCaptchaService;

  beforeEach(() => {
    seen.clear();
    redis.set.mockClear();
    service = new WorkflowPublicCaptchaService(config('s1') as never, redis as never);
  });

  it('counts leading zero bits', () => {
    expect(leadingZeroBits(Buffer.from([0x00, 0x0f]))).toBe(12);
    expect(leadingZeroBits(Buffer.from([0x80]))).toBe(0);
    expect(leadingZeroBits(Buffer.from([0x00, 0x00]))).toBe(16);
  });

  it('issues a signed SHA-256 challenge that expires in 5 minutes', () => {
    const now = Date.now();
    const c = service.issue(7, now);
    expect(c).toMatchObject({ algorithm: 'SHA-256', difficulty: CAPTCHA_DIFFICULTY_BITS });
    expect(c.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(Date.parse(c.expires_at) - now).toBe(CAPTCHA_TTL_MS);
    expect(c.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a solved challenge once', async () => {
    const proof = solveCaptcha(service.issue(7));
    await expect(service.verify(7, proof)).resolves.toBeUndefined();
    expect(await codeOf(service.verify(7, proof))).toBe('WORKFLOW_PUBLIC_CAPTCHA_INVALID');
  });

  it('rejects a missing proof, a wrong solution, a tampered signature and another link', async () => {
    const c = service.issue(7);
    expect(await codeOf(service.verify(7, undefined))).toBe('WORKFLOW_PUBLIC_CAPTCHA_INVALID');
    let wrong = 0;
    while (
      leadingZeroBits(createHash('sha256').update(`${c.salt}${wrong}`).digest()) >= c.difficulty
    ) {
      wrong++;
    }
    expect(await codeOf(service.verify(7, { ...solveCaptcha(c), number: wrong }))).toBe('WORKFLOW_PUBLIC_CAPTCHA_INVALID');
    expect(await codeOf(service.verify(7, { ...solveCaptcha(c), signature: 'a'.repeat(64) }))).toBe('WORKFLOW_PUBLIC_CAPTCHA_INVALID');
    expect(await codeOf(service.verify(8, solveCaptcha(c)))).toBe('WORKFLOW_PUBLIC_CAPTCHA_INVALID');
  });

  it('rejects an expired challenge and one signed by another server secret', async () => {
    const c = service.issue(7, Date.now() - CAPTCHA_TTL_MS - 1000);
    expect(await codeOf(service.verify(7, solveCaptcha(c)))).toBe('WORKFLOW_PUBLIC_CAPTCHA_INVALID');
    const other = new WorkflowPublicCaptchaService(config('s2') as never, redis as never);
    expect(await codeOf(service.verify(7, solveCaptcha(other.issue(7))))).toBe('WORKFLOW_PUBLIC_CAPTCHA_INVALID');
  });

  it('falls back to a per-process memory when Redis fails and still blocks a replay', async () => {
    redis.set.mockRejectedValue(new Error('redis down'));
    const proof = solveCaptcha(service.issue(7));
    await expect(service.verify(7, proof)).resolves.toBeUndefined();
    expect(await codeOf(service.verify(7, proof))).toBe('WORKFLOW_PUBLIC_CAPTCHA_INVALID');
    redis.set.mockImplementation(async (key: string) => {
      if (seen.has(key)) return null;
      seen.add(key);
      return 'OK';
    });
  });
});
