import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import {
  BULK_JOB_LOCK_TTL_SECONDS,
  bulkJobLockKey,
  type BulkJobType,
} from './bulk-upload-job.types';

const COMPARE_AND_DELETE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * Candado `bulk-upload:active:{store_id}:{type}` (valor = id de la fila): una
 * sola carga activa por tienda y tipo. Se libera por compare-and-delete para
 * no soltar el candado de otro trabajo.
 */
@Injectable()
export class BulkUploadJobLockService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** `null` si se obtuvo; si no, el id del trabajo que lo tiene. */
  async acquire(
    storeId: number,
    type: BulkJobType,
    logId: number,
  ): Promise<{ acquired: true } | { acquired: false; holder: number | null }> {
    const key = bulkJobLockKey(storeId, type);
    const ok = await this.redis.set(
      key,
      String(logId),
      'EX',
      BULK_JOB_LOCK_TTL_SECONDS,
      'NX',
    );
    if (ok === 'OK') return { acquired: true };
    const holder = Number(await this.redis.get(key));
    return { acquired: false, holder: Number.isFinite(holder) && holder > 0 ? holder : null };
  }

  async release(
    storeId: number,
    type: BulkJobType,
    logId: number,
  ): Promise<void> {
    await this.redis.eval(
      COMPARE_AND_DELETE,
      1,
      bulkJobLockKey(storeId, type),
      String(logId),
    );
  }
}
