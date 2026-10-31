import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import { resolveStoreTimezone } from '../../../../../common/utils/store-timezone.util';
import { maskAddress } from '../../../../../messaging/utils/mask-address.util';
import { CustomersService } from '../../customers.service';
import { RfmGroupRow, rfmPeriodStart, scoreRfmPopulation } from '../shared/crm-rfm';
import {
  MetaFieldRef,
  SegmentFilterError,
  SegmentGroup,
  collectSegmentRequirements,
  compileSegmentFilter,
  parseSegmentFilter,
  segmentCustomersFrom,
} from './segment-filter.compiler';

/** Seeing full phones and emails (PLAN-CRM §6); without it they are masked. */
export const CONTACT_READ_PERMISSION = 'store:customers:contact:read';

export interface ResolvedSegment {
  store_id: number;
  filter: SegmentGroup;
  from: Prisma.Sql;
}

export interface SegmentCustomerRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  orders_count: number;
  total_spent: string;
  last_order_at: Date | null;
}

/** A customer of the segment with what a campaign needs to reach them. */
export interface SegmentRecipientRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  whatsapp_consent: string;
  sms_consent: string;
  email_consent: string;
}

/**
 * Evaluates segment filters for the store of the request. Filters are
 * dynamic: they are compiled and run every time, never materialized.
 *
 * The query is raw SQL over fixed fragments of the compiler, so the store
 * scope of `StorePrismaService` does not apply: every table of
 * {@link segmentCustomersFrom} filters by the `store_id` of the request
 * context explicitly, and ids in the filter are checked against the store.
 */
@Injectable()
export class CrmSegmentQueryService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly customers: CustomersService,
  ) {}

  async resolve(rawFilter: unknown, now = new Date()): Promise<ResolvedSegment> {
    const storeId = this.storeId();
    let filter: SegmentGroup;
    try {
      filter = parseSegmentFilter(rawFilter);
    } catch (error) {
      throw this.toHttp(error);
    }

    const req = collectSegmentRequirements(filter);
    await this.assertTags(req.tag_ids);
    await this.assertStages(req.stage_ids);
    const [metaFields, rfmMembers, timezone] = await Promise.all([
      this.metaFields(req.meta_keys),
      this.rfmMembers(req.rfm_segments, now),
      resolveStoreTimezone(this.prisma, storeId),
    ]);

    try {
      const condition = compileSegmentFilter(filter, {
        store_id: storeId,
        now,
        timezone,
        meta_fields: metaFields,
        rfm_members: rfmMembers,
      });
      return { store_id: storeId, filter, from: segmentCustomersFrom(storeId, condition) };
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async count(segment: ResolvedSegment): Promise<number> {
    const rows = await this.prisma.withoutScope().$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS "count" ${segment.from}`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Newest customers first; contact data masked without `contact:read`. */
  async page(segment: ResolvedSegment, page: number, limit: number) {
    const rows = await this.prisma.withoutScope().$queryRaw<SegmentCustomerRow[]>(
      Prisma.sql`
        SELECT u."id", u."first_name", u."last_name", u."email", u."phone",
               COALESCE(os."orders_count", 0)::int AS "orders_count",
               COALESCE(os."total_spent", 0)::text AS "total_spent",
               os."last_order_at"
        ${segment.from}
        ORDER BY su."createdAt" DESC, u."id" DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    );
    const reveal = this.canReadContact();
    return rows.map((row) => ({
      ...row,
      email: reveal ? row.email : row.email ? maskAddress(row.email) : null,
      phone: reveal ? row.phone : row.phone ? maskAddress(row.phone) : null,
    }));
  }

  /** Every customer of the segment, at most `cap + 1` so callers detect overflow. */
  async recipients(segment: ResolvedSegment, cap: number): Promise<SegmentRecipientRow[]> {
    return this.prisma.withoutScope().$queryRaw<SegmentRecipientRow[]>(
      Prisma.sql`
        SELECT u."id", u."first_name", u."last_name", u."email", u."phone",
               su."whatsapp_consent"::text AS "whatsapp_consent",
               su."sms_consent"::text AS "sms_consent",
               su."email_consent"::text AS "email_consent"
        ${segment.from}
        ORDER BY u."id" ASC
        LIMIT ${cap + 1}`,
    );
  }

  canReadContact(): boolean {
    const context = RequestContextService.getContext();
    return (
      !!context?.is_super_admin ||
      !!context?.is_owner ||
      !!context?.permissions?.includes(CONTACT_READ_PERMISSION)
    );
  }

  private storeId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.CRM_SEGMENT_002);
    return storeId;
  }

  private async assertTags(ids: number[]) {
    if (!ids.length) return;
    const found = await this.prisma.crm_tags.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const missing = ids.filter((id) => !found.some((tag) => tag.id === id));
    if (missing.length) {
      throw new VendixHttpException(
        ErrorCodes.CRM_SEGMENT_001,
        `La etiqueta ${missing.join(', ')} no existe en esta tienda`,
        { path: 'filter', field: 'tag' },
      );
    }
  }

  private async assertStages(ids: number[]) {
    if (!ids.length) return;
    const found = await this.prisma.crm_pipeline_stages.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const missing = ids.filter((id) => !found.some((stage) => stage.id === id));
    if (missing.length) {
      throw new VendixHttpException(
        ErrorCodes.CRM_SEGMENT_001,
        `La etapa ${missing.join(', ')} no existe en esta tienda`,
        { path: 'filter', field: 'stage' },
      );
    }
  }

  private async metaFields(keys: string[]): Promise<Map<string, MetaFieldRef>> {
    if (!keys.length) return new Map();
    const fields = await this.prisma.entity_metadata_fields.findMany({
      where: { entity_type: 'customer', is_active: true, field_key: { in: keys } },
      select: { id: true, field_key: true, field_type: true },
    });
    return new Map(
      fields.map((field) => [field.field_key, { id: field.id, field_type: field.field_type }]),
    );
  }

  private async rfmMembers(segments: string[], now: Date): Promise<Map<string, number[]>> {
    const members = new Map<string, number[]>();
    if (!segments.length) return members;
    const grouped = (await this.customers.getSegmentPopulationForAgent(
      rfmPeriodStart(now),
    )) as RfmGroupRow[];
    for (const entry of scoreRfmPopulation(grouped, now).values()) {
      if (!segments.includes(entry.segment)) continue;
      const ids = members.get(entry.segment) ?? [];
      ids.push(entry.customer_id);
      members.set(entry.segment, ids);
    }
    return members;
  }

  private toHttp(error: unknown): unknown {
    if (error instanceof SegmentFilterError) {
      return new VendixHttpException(ErrorCodes.CRM_SEGMENT_001, error.message, {
        path: error.path,
      });
    }
    return error;
  }
}
