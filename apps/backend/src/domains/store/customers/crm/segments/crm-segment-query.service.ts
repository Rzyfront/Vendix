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
  SegmentRequirements,
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

/** A saved segment: its rules (when `is_dynamic`) plus its manual members. */
export interface SavedSegmentRef {
  id: number;
  filter: unknown;
  is_dynamic: boolean;
}

/** Rule queries in flight at once when resolving many segments. */
const RULE_QUERY_CONCURRENCY = 4;

interface LoadedCompileContext {
  tagIds: Set<number>;
  stageIds: Set<number>;
  metaFields: Map<string, MetaFieldRef>;
  rfmMembers: Map<string, number[]>;
  timezone: string;
}

/** Union of what several filters need, without repeats. */
function mergeRequirements(all: SegmentRequirements[]): SegmentRequirements {
  const union = <T>(pick: (req: SegmentRequirements) => T[]) => [
    ...new Set(all.flatMap(pick)),
  ];
  return {
    tag_ids: union((req) => req.tag_ids),
    stage_ids: union((req) => req.stage_ids),
    owner_ids: union((req) => req.owner_ids),
    meta_keys: union((req) => req.meta_keys),
    rfm_segments: union((req) => req.rfm_segments),
  };
}

/** Filter stored by a manual segment: no rules, only `crm_segment_members`. */
export const MANUAL_SEGMENT_FILTER: SegmentGroup = { op: 'and', rules: [] };

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
    const { filter, condition } = await this.compile(storeId, rawFilter, now);
    return { store_id: storeId, filter, from: segmentCustomersFrom(storeId, condition) };
  }

  /**
   * A saved segment: customers that match its rules or were added by hand
   * (`crm_segment_members`). A manual segment (`is_dynamic = false`) has no
   * rules and is only its members. `customerIds` narrows the evaluation to
   * those customers (memberships of a page of the customer list).
   */
  async resolveSaved(
    saved: SavedSegmentRef,
    now = new Date(),
    customerIds?: number[],
  ): Promise<ResolvedSegment> {
    const storeId = this.storeId();
    const member = Prisma.sql`EXISTS (
      SELECT 1 FROM "crm_segment_members" sm
      WHERE sm."segment_id" = ${saved.id}
        AND sm."store_id" = ${storeId}
        AND sm."customer_id" = su."user_id"
    )`;
    let filter = MANUAL_SEGMENT_FILTER;
    let condition = member;
    if (saved.is_dynamic) {
      const compiled = await this.compile(storeId, saved.filter, now);
      filter = compiled.filter;
      condition = Prisma.sql`(${compiled.condition} OR ${member})`;
    }
    return {
      store_id: storeId,
      filter,
      from: segmentCustomersFrom(storeId, condition, customerIds),
    };
  }

  /**
   * For each rule segment, the ids among `customerIds` that match its rules
   * (without its manual members), so a profile tells "by rule" from "added by
   * hand". Tags, stages, custom fields, RFM and timezone load once for all
   * segments; a segment whose rules no longer compile maps to its error.
   */
  async ruleMembersOf(
    segments: Array<{ id: number; filter: unknown }>,
    customerIds: number[],
    now = new Date(),
  ): Promise<Map<number, number[] | Error>> {
    const result = new Map<number, number[] | Error>();
    if (!segments.length || !customerIds.length) return result;
    const storeId = this.storeId();

    const parsed: Array<{ id: number; filter: SegmentGroup; req: SegmentRequirements }> = [];
    for (const segment of segments) {
      try {
        const filter = parseSegmentFilter(segment.filter);
        parsed.push({ id: segment.id, filter, req: collectSegmentRequirements(filter) });
      } catch (error) {
        result.set(segment.id, error as Error);
      }
    }
    const context = await this.loadContext(
      storeId,
      mergeRequirements(parsed.map((entry) => entry.req)),
      now,
    );

    for (let i = 0; i < parsed.length; i += RULE_QUERY_CONCURRENCY) {
      await Promise.all(
        parsed.slice(i, i + RULE_QUERY_CONCURRENCY).map(async (entry) => {
          try {
            const condition = this.compileWith(storeId, entry.filter, entry.req, context, now);
            result.set(
              entry.id,
              await this.memberIds({
                store_id: storeId,
                filter: entry.filter,
                from: segmentCustomersFrom(storeId, condition, customerIds),
              }),
            );
          } catch (error) {
            result.set(entry.id, error as Error);
          }
        }),
      );
    }
    return result;
  }

  private async compile(
    storeId: number,
    rawFilter: unknown,
    now: Date,
  ): Promise<{ filter: SegmentGroup; condition: Prisma.Sql }> {
    let filter: SegmentGroup;
    try {
      filter = parseSegmentFilter(rawFilter);
    } catch (error) {
      throw this.toHttp(error);
    }
    const req = collectSegmentRequirements(filter);
    const context = await this.loadContext(storeId, req, now);
    return { filter, condition: this.compileWith(storeId, filter, req, context, now) };
  }

  /** Everything a set of filters needs from the database, read once. */
  private async loadContext(
    storeId: number,
    req: SegmentRequirements,
    now: Date,
  ): Promise<LoadedCompileContext> {
    const [tagIds, stageIds, metaFields, rfmMembers, timezone] = await Promise.all([
      this.existingTags(req.tag_ids),
      this.existingStages(req.stage_ids),
      this.metaFields(req.meta_keys),
      this.rfmMembers(req.rfm_segments, now),
      resolveStoreTimezone(this.prisma, storeId),
    ]);
    return { tagIds, stageIds, metaFields, rfmMembers, timezone };
  }

  private compileWith(
    storeId: number,
    filter: SegmentGroup,
    req: SegmentRequirements,
    context: LoadedCompileContext,
    now: Date,
  ): Prisma.Sql {
    const missingTags = req.tag_ids.filter((id) => !context.tagIds.has(id));
    if (missingTags.length) {
      throw new VendixHttpException(
        ErrorCodes.CRM_SEGMENT_001,
        `La etiqueta ${missingTags.join(', ')} no existe en esta tienda`,
        { path: 'filter', field: 'tag' },
      );
    }
    const missingStages = req.stage_ids.filter((id) => !context.stageIds.has(id));
    if (missingStages.length) {
      throw new VendixHttpException(
        ErrorCodes.CRM_SEGMENT_001,
        `La etapa ${missingStages.join(', ')} no existe en esta tienda`,
        { path: 'filter', field: 'stage' },
      );
    }
    try {
      return compileSegmentFilter(filter, {
        store_id: storeId,
        now,
        timezone: context.timezone,
        meta_fields: context.metaFields,
        rfm_members: context.rfmMembers,
      });
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  /** Ids of the given customers that belong to the segment. */
  async memberIds(segment: ResolvedSegment): Promise<number[]> {
    const rows = await this.prisma.withoutScope().$queryRaw<Array<{ id: number }>>(
      Prisma.sql`SELECT u."id" ${segment.from}`,
    );
    return rows.map((row) => Number(row.id));
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

  private async existingTags(ids: number[]): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const found = await this.prisma.crm_tags.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(found.map((tag) => tag.id));
  }

  private async existingStages(ids: number[]): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const found = await this.prisma.crm_pipeline_stages.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(found.map((stage) => stage.id));
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
