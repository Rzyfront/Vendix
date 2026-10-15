import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

export interface GuestOrderBinding {
  order_id: number;
  store_id: number;
  organization_id: number;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Capability bootstrap: only opaque UUIDs are looked up globally; no PII is returned.
 * Legacy fiscal expiry deliberately does not revoke purchase support. */
@Injectable()
export class GuestOrderAccessService {
  constructor(private readonly prisma: GlobalPrismaService) {}
  async resolve(
    token: string,
    expectedStoreId?: number,
  ): Promise<GuestOrderBinding | null> {
    if (typeof token !== 'string' || !UUID.test(token)) return null;
    const rows = await this.prisma.$queryRaw<GuestOrderBinding[]>(Prisma.sql`
      SELECT o.id AS order_id, o.store_id, s.organization_id
      FROM orders o JOIN stores s ON s.id=o.store_id
      WHERE o.public_access_token = ${token}
        OR EXISTS (SELECT 1 FROM invoice_data_requests r
                   WHERE r.token=${token} AND r.order_id=o.id AND r.store_id=o.store_id)
      LIMIT 2`);
    if (rows.length !== 1) return null;
    const binding = rows[0];
    return expectedStoreId && binding.store_id !== expectedStoreId
      ? null
      : binding;
  }
}
