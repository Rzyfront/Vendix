import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import { isStoreCustomer, resolveCrmViewer } from '../shared/crm-access';
import { CrmSegmentQueryService } from './crm-segment-query.service';

/** How a customer belongs to a segment. */
export type SegmentMembershipVia = 'rule' | 'manual' | 'both';

export interface CustomerSegmentMembership {
  id: number;
  name: string;
  is_dynamic: boolean;
  via: SegmentMembershipVia;
}

export interface CustomerTagRef {
  id: number;
  name: string;
  color: string | null;
}

export interface CustomerCrmMemberships {
  customer_id: number;
  tags: CustomerTagRef[];
  segments: CustomerSegmentMembership[];
}

/**
 * Segments and tags of given customers (a page of the customer list or one
 * profile), and the manual membership of a customer in a segment.
 *
 * A segment is its rules ∪ its manual members (`crm_segment_members`):
 * adding by hand writes a member row; removing deletes only that row, so a
 * customer that also matches the rules stays in the segment.
 */
@Injectable()
export class CrmSegmentMembersService {
  private readonly logger = new Logger(CrmSegmentMembersService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly query: CrmSegmentQueryService,
  ) {}

  async membershipsOf(customerIds: number[]): Promise<CustomerCrmMemberships[]> {
    const ids = [...new Set(customerIds)];
    if (!ids.length) return [];
    const now = new Date();

    const [segments, manualRows, tagRows] = await Promise.all([
      this.prisma.crm_segments.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, filter: true, is_dynamic: true },
      }),
      this.prisma.crm_segment_members.findMany({
        where: { customer_id: { in: ids } },
        select: { segment_id: true, customer_id: true },
      }),
      this.prisma.crm_customer_tags.findMany({
        where: { customer_id: { in: ids } },
        select: {
          customer_id: true,
          tag: { select: { id: true, name: true, color: true } },
        },
        orderBy: { tag: { name: 'asc' } },
      }),
    ]);

    const manual = new Set(
      manualRows.map((row) => `${row.segment_id}:${row.customer_id}`),
    );
    const ruleMembers = new Map<number, Set<number>>();
    await Promise.all(
      segments
        .filter((segment) => segment.is_dynamic)
        .map(async (segment) => {
          try {
            const matched = await this.query.ruleMemberIds(segment.filter, ids, now);
            ruleMembers.set(segment.id, new Set(matched));
          } catch (error) {
            // A segment whose rules no longer compile (a deleted tag or stage)
            // must not hide the rest; it shows only its manual members.
            this.logger.warn(
              `Segment ${segment.id} skipped in memberships: ${(error as Error).message}`,
            );
          }
        }),
    );

    return ids.map((customerId) => ({
      customer_id: customerId,
      tags: tagRows
        .filter((row) => row.customer_id === customerId)
        .map((row) => row.tag),
      segments: segments.flatMap((segment) => {
        const byRule = ruleMembers.get(segment.id)?.has(customerId) ?? false;
        const byHand = manual.has(`${segment.id}:${customerId}`);
        if (!byRule && !byHand) return [];
        const via: SegmentMembershipVia =
          byRule && byHand ? 'both' : byRule ? 'rule' : 'manual';
        return [{ id: segment.id, name: segment.name, is_dynamic: segment.is_dynamic, via }];
      }),
    }));
  }

  /** Adds the customer to the segment by hand; adding twice is a no-op. */
  async add(customerId: number, segmentId: number) {
    const viewer = resolveCrmViewer(ErrorCodes.CRM_CUSTOMER_001);
    await this.assertCustomer(customerId);
    await this.assertSegment(segmentId);
    await this.prisma.crm_segment_members.createMany({
      data: [
        {
          store_id: viewer.store_id,
          segment_id: segmentId,
          customer_id: customerId,
          created_by_user_id: viewer.user_id,
        },
      ],
      skipDuplicates: true,
    });
    return this.single(customerId);
  }

  /** Removes the manual membership; membership by rule is not touched. */
  async remove(customerId: number, segmentId: number) {
    await this.assertCustomer(customerId);
    await this.assertSegment(segmentId);
    await this.prisma.crm_segment_members.deleteMany({
      where: { segment_id: segmentId, customer_id: customerId },
    });
    return this.single(customerId);
  }

  private async single(customerId: number): Promise<CustomerCrmMemberships> {
    const [memberships] = await this.membershipsOf([customerId]);
    return memberships;
  }

  private async assertCustomer(customerId: number) {
    if (!(await isStoreCustomer(this.prisma, customerId))) {
      throw new VendixHttpException(ErrorCodes.CRM_CUSTOMER_001);
    }
  }

  private async assertSegment(segmentId: number) {
    const segment = await this.prisma.crm_segments.findFirst({
      where: { id: segmentId },
      select: { id: true },
    });
    if (!segment) throw new VendixHttpException(ErrorCodes.CRM_SEGMENT_002);
  }
}
