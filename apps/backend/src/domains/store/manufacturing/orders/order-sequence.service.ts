import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

export const PRODUCTION_ORDER_SEQUENCE_KEY = 'production_order';
export const DEFAULT_PRODUCTION_ORDER_PREFIX = 'OP-';

/** Formatea el consecutivo: prefijo + número con 6 dígitos (OP-000123). */
export function formatOrderNumber(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(6, '0')}`;
}

/**
 * Consecutivos por tienda (`store_sequences`). La asignación es un único
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING`, atómico a nivel de fila, y
 * debe ejecutarse dentro de la misma transacción que crea el documento para
 * que un fallo no deje huecos. Se usa SQL directo porque el upsert de Prisma
 * sobre la unique compuesta choca con el scope por tienda (WhereUnique + AND).
 */
@Injectable()
export class OrderSequenceService {
  async next(
    tx: Prisma.TransactionClient,
    store_id: number,
    key: string = PRODUCTION_ORDER_SEQUENCE_KEY,
    defaultPrefix: string = DEFAULT_PRODUCTION_ORDER_PREFIX,
  ): Promise<string> {
    const rows = await tx.$queryRaw<
      Array<{ prefix: string; assigned: number }>
    >`
      INSERT INTO store_sequences (store_id, key, prefix, next_number, created_at, updated_at)
      VALUES (${store_id}, ${key}, ${defaultPrefix}, 2, NOW(), NOW())
      ON CONFLICT (store_id, key)
      DO UPDATE SET next_number = store_sequences.next_number + 1, updated_at = NOW()
      RETURNING prefix, (next_number - 1)::int AS assigned
    `;
    const row = rows?.[0];
    if (!row) {
      throw new VendixHttpException(ErrorCodes.MFG_SEQUENCE_FAILED);
    }
    return formatOrderNumber(row.prefix, Number(row.assigned));
  }
}
