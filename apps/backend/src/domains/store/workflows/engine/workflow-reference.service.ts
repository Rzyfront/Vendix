import { Injectable } from '@nestjs/common';
import { WorkflowTx } from './workflow-engine.types';

/**
 * `FLU-` + zero-padded per-store sequence.
 *
 * Strategy: lock, then read. Inside the start transaction the store row is
 * locked with `FOR NO KEY UPDATE` (does not block FK checks of other tables
 * that reference `stores`, unlike `FOR UPDATE`), so concurrent starts of the
 * same store queue up and each sees the previous reference once committed.
 * `@@unique([store_id, reference])` stays as the safety net. A retry on the
 * unique conflict is NOT possible: in PostgreSQL a failed statement aborts the
 * whole transaction.
 */
@Injectable()
export class WorkflowReferenceService {
  async next(tx: WorkflowTx, storeId: number): Promise<string> {
    await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId} FOR NO KEY UPDATE`;
    const rows: Array<{ n: number | bigint }> = await tx.$queryRaw`
      SELECT (COALESCE(MAX(CAST(SUBSTRING(reference FROM 5) AS INTEGER)), 0) + 1)::int AS n
      FROM workflow_instances
      WHERE store_id = ${storeId} AND reference ~ '^FLU-[0-9]+$'`;
    const n = Number(rows[0]?.n ?? 1);
    return `FLU-${String(n).padStart(6, '0')}`;
  }
}
