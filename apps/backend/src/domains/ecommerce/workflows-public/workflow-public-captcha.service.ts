import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { REDIS_CLIENT } from '@common/redis/redis.module';

/** Leading zero bits of sha256(salt + number): ~2^18 hashes on average. */
export const CAPTCHA_DIFFICULTY_BITS = 18;
export const CAPTCHA_TTL_MS = 5 * 60_000;
const CAPTCHA_ALGORITHM = 'SHA-256';

export interface CaptchaChallenge {
  challenge: string;
  salt: string;
  algorithm: typeof CAPTCHA_ALGORITHM;
  difficulty: number;
  expires_at: string;
  signature: string;
}

export interface CaptchaProof {
  salt: string;
  number: number;
  expires_at: string;
  signature: string;
}

export function leadingZeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/**
 * Own proof-of-work captcha (no external provider). The server signs
 * `(salt, difficulty, expires, link id)` with an HMAC; the browser finds a
 * `number` whose `sha256(salt + number)` has the required leading zero bits;
 * the submit carries the proof back. Single use: the salt is remembered in
 * Redis (5 min); if Redis is unreachable a per-process map with the same TTL
 * is used, so across several API processes a replay is only blocked by Redis.
 */
@Injectable()
export class WorkflowPublicCaptchaService {
  private readonly logger = new Logger(WorkflowPublicCaptchaService.name);
  private readonly key: Buffer;
  private readonly used = new Map<string, number>();

  constructor(
    config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const base = config.get<string>('JWT_SECRET') ?? config.get<string>('DIAN_ENCRYPTION_KEY');
    // Without any app secret the key is random per process: proofs still verify
    // inside it and nothing can be forged from outside.
    this.key = createHash('sha256')
      .update(`vendix:workflow-public-captcha:${base ?? randomBytes(32).toString('hex')}`)
      .digest();
  }

  issue(linkId: number, now = Date.now()): CaptchaChallenge {
    const salt = randomBytes(16).toString('hex');
    const expires_at = new Date(now + CAPTCHA_TTL_MS).toISOString();
    return {
      challenge: this.challengeOf(salt),
      salt,
      algorithm: CAPTCHA_ALGORITHM,
      difficulty: CAPTCHA_DIFFICULTY_BITS,
      expires_at,
      signature: this.sign(salt, CAPTCHA_DIFFICULTY_BITS, expires_at, linkId),
    };
  }

  /** Throws `WORKFLOW_PUBLIC_CAPTCHA_INVALID` unless the proof is valid and unused. */
  async verify(linkId: number, proof: CaptchaProof | undefined, now = Date.now()): Promise<void> {
    const invalid = () => new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_CAPTCHA_INVALID);
    if (
      !proof ||
      typeof proof.salt !== 'string' ||
      !/^[0-9a-f]{32}$/.test(proof.salt) ||
      !Number.isSafeInteger(proof.number) ||
      proof.number < 0 ||
      typeof proof.expires_at !== 'string' ||
      typeof proof.signature !== 'string'
    ) {
      throw invalid();
    }
    const expires = Date.parse(proof.expires_at);
    if (!Number.isFinite(expires) || expires <= now || expires - now > CAPTCHA_TTL_MS) throw invalid();
    const expected = Buffer.from(this.sign(proof.salt, CAPTCHA_DIFFICULTY_BITS, proof.expires_at, linkId));
    const given = Buffer.from(proof.signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
    const digest = createHash('sha256').update(`${proof.salt}${proof.number}`).digest();
    if (leadingZeroBits(digest) < CAPTCHA_DIFFICULTY_BITS) throw invalid();
    if (!(await this.markUsed(proof.salt, expires - now))) throw invalid();
  }

  private sign(salt: string, difficulty: number, expiresAt: string, linkId: number): string {
    return createHmac('sha256', this.key)
      .update(`${salt}|${this.challengeOf(salt)}|${difficulty}|${expiresAt}|${linkId}`)
      .digest('hex');
  }

  private challengeOf(salt: string): string {
    return createHmac('sha256', this.key).update(`challenge|${salt}`).digest('hex').slice(0, 16);
  }

  /** true when the salt was not used before. */
  private async markUsed(salt: string, ttlMs: number): Promise<boolean> {
    try {
      const res = await this.redis.set(
        `workflow:captcha:used:${salt}`,
        '1',
        'PX',
        Math.max(1, Math.ceil(ttlMs)),
        'NX',
      );
      return res === 'OK';
    } catch (e) {
      this.logger.warn(`Captcha single-use falls back to memory: ${(e as Error)?.message}`);
      const now = Date.now();
      for (const [k, until] of this.used) if (until <= now) this.used.delete(k);
      if (this.used.has(salt)) return false;
      this.used.set(salt, now + ttlMs);
      return true;
    }
  }
}
