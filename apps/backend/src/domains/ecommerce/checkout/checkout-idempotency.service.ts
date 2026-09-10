import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

/**
 * A.4 CP-facturacion-fixes — `Idempotency-Key` store for web checkout.
 *
 * Protocol (per store + key, TTL 24h):
 * - `begin()`: no key (or no store in context) → `{ replay: false }`, passthrough.
 *   Otherwise INSERT a `pending` row. Unique violation → fetch the winner:
 *   `completed` + fresh ⇒ `{ replay: true, response }`; `pending`/fresh ⇒ 409
 *   `ECOM_CHECKOUT_006` (client retries, never assumes success); expired ⇒
 *   delete + reclaim.
 * - `complete()`: stores the JSON-normalized response, flips to `completed`.
 * - `discard()`: deletes the row so a failed attempt never poisons retries.
 *
 * The stored response is `JSON.parse(JSON.stringify(...))`-normalized, so a
 * replay returns exactly what the wire would have carried (Prisma Decimals
 * included) without leaking live object references.
 */
@Injectable()
export class CheckoutIdempotencyService {
  private readonly logger = new Logger(CheckoutIdempotencyService.name);
  private static readonly TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly MAX_KEY_LENGTH = 100;

  constructor(private readonly prisma: StorePrismaService) {}

  private resolve(storeId: number | null, key?: string): { storeId: number; key: string } | null {
    const clean = (key ?? '').trim();
    if (!clean || clean.length > CheckoutIdempotencyService.MAX_KEY_LENGTH) {
      return null;
    }
    if (!storeId) return null;
    return { storeId, key: clean };
  }

  async begin(
    key?: string,
  ): Promise<{ replay: false } | { replay: true; response: any }> {
    const storeId = RequestContextService.getStoreId();
    const ctx = this.resolve(storeId ?? null, key);
    if (!ctx) return { replay: false };
    const now = new Date();
    try {
      await this.prisma.checkout_idempotency_keys.create({
        data: {
          store_id: ctx.storeId,
          idempotency_key: ctx.key,
          status: 'pending',
          expires_at: new Date(now.getTime() + CheckoutIdempotencyService.TTL_MS),
        },
      });
      return { replay: false };
    } catch (error) {
      // Duck-typed on purpose: `instanceof` breaks across duplicated Prisma
      // client copies, while the `P2002` code is the stable contract.
      if ((error as any)?.code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.checkout_idempotency_keys.findUnique({
        where: {
          store_id_idempotency_key: {
            store_id: ctx.storeId,
            idempotency_key: ctx.key,
          },
        },
      });
      if (
        existing &&
        existing.status === 'completed' &&
        existing.expires_at > now &&
        existing.response !== null
      ) {
        return { replay: true, response: existing.response };
      }
      if (existing && existing.expires_at <= now) {
        await this.prisma.checkout_idempotency_keys
          .delete({ where: { id: existing.id } })
          .catch(() => null);
        return this.begin(key);
      }
      throw new VendixHttpException(ErrorCodes.ECOM_CHECKOUT_006);
    }
  }

  async complete(key: string | undefined, response: unknown): Promise<void> {
    const storeId = RequestContextService.getStoreId();
    const ctx = this.resolve(storeId ?? null, key);
    if (!ctx) return;
    const normalized =
      response === undefined ? null : JSON.parse(JSON.stringify(response));
    await this.prisma.checkout_idempotency_keys
      .updateMany({
        where: {
          store_id: ctx.storeId,
          idempotency_key: ctx.key,
          status: 'pending',
        },
        data: { status: 'completed', response: normalized },
      })
      .catch((error: unknown) =>
        this.logger.warn(
          `Idempotency complete failed (non-blocking): ${(error as Error)?.message}`,
        ),
      );
  }

  async discard(key: string | undefined): Promise<void> {
    const storeId = RequestContextService.getStoreId();
    const ctx = this.resolve(storeId ?? null, key);
    if (!ctx) return;
    await this.prisma.checkout_idempotency_keys
      .deleteMany({
        where: { store_id: ctx.storeId, idempotency_key: ctx.key },
      })
      .catch(() => null);
  }
}
