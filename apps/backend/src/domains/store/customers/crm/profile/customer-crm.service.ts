import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { AuditService } from '../../../../../common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import { CustomersService } from '../../customers.service';
import { CustomerHistoryService } from '../../history/customer-history.service';
import {
  RFM_DEFINITIONS,
  rfmScores,
  rfmSegment,
} from '../../../../../ai-engine/tools/domains/customers.tools';
import {
  CrmViewer,
  isActiveStoreStaff,
  isStoreCustomer,
  resolveCrmViewer,
} from '../shared/crm-access';
import {
  CreateCrmCustomerNoteDto,
  CrmNotesQueryDto,
  CustomerCrmTimelineQueryDto,
  UpdateCrmCustomerNoteDto,
  UpdateCustomerCrmProfileDto,
} from './dto/customer-crm.dto';

/** Window the RFM scores are measured over, same default as the agent tool. */
export const CRM_RFM_PERIOD_DAYS = 365;
/** A customer owner must be able to read customers. */
const CUSTOMER_OWNER_PERMISSION = 'store:customers:read';
const PERSON_SELECT = { id: true, first_name: true, last_name: true } as const;
const DAY_MS = 86_400_000;

/**
 * Customer 360 (PLAN-CRM §4.4): CRM attributes stored on `store_users` (the
 * per-store customer row), tags, free notes and the unified timeline, which
 * lives in `CustomerHistoryService` next to the booking history it extends.
 */
@Injectable()
export class CustomerCrmService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly history: CustomerHistoryService,
  ) {}

  async getProfile(customerId: number) {
    const viewer = this.viewer();
    const membership = await this.membership(customerId);
    const now = new Date();
    const ownTasks = viewer.can_see_all
      ? {}
      : {
          OR: [
            { assigned_user_id: viewer.user_id },
            { created_by_user_id: viewer.user_id },
          ],
        };
    const ownOpportunities = viewer.can_see_all
      ? {}
      : { owner_user_id: viewer.user_id };

    const [customer, tags, openTasks, overdueTasks, opportunities, rfm] =
      await Promise.all([
        this.prisma.users.findUnique({
          where: { id: customerId },
          select: PERSON_SELECT,
        }),
        this.tagsOf(customerId),
        this.prisma.crm_tasks.count({
          where: { customer_id: customerId, status: 'pending', ...ownTasks },
        }),
        this.prisma.crm_tasks.count({
          where: {
            customer_id: customerId,
            status: 'pending',
            due_at: { lt: now },
            ...ownTasks,
          },
        }),
        this.prisma.crm_opportunities.aggregate({
          where: {
            customer_id: customerId,
            status: 'open',
            ...ownOpportunities,
          },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        this.rfm(customerId, now),
      ]);

    return {
      customer,
      owner: membership.crm_owner,
      source: membership.crm_source,
      stage: membership.crm_stage,
      last_contact_at: membership.crm_last_contact_at,
      consents: {
        whatsapp: membership.whatsapp_consent,
        sms: membership.sms_consent,
        email: membership.email_consent,
        updated_at: membership.consent_updated_at,
      },
      tags,
      open_tasks: openTasks,
      overdue_tasks: overdueTasks,
      open_opportunities: {
        count: opportunities._count._all,
        amount: opportunities._sum.amount?.toString() ?? '0',
      },
      rfm,
    };
  }

  async updateProfile(customerId: number, dto: UpdateCustomerCrmProfileDto) {
    const viewer = this.viewer();
    const before = await this.membership(customerId);
    const data: Prisma.store_usersUncheckedUpdateManyInput = {};

    if (dto.owner_user_id !== undefined) {
      // Changing the owner is an assignment: same permission as the inbox.
      if (!viewer.can_see_all) {
        throw new VendixHttpException(ErrorCodes.CRM_PROFILE_001);
      }
      if (
        dto.owner_user_id !== null &&
        !(await isActiveStoreStaff(
          this.prisma,
          dto.owner_user_id,
          CUSTOMER_OWNER_PERMISSION,
        ))
      ) {
        throw new VendixHttpException(ErrorCodes.CRM_STAFF_001);
      }
      data.crm_owner_user_id = dto.owner_user_id;
    }
    if (dto.source !== undefined) data.crm_source = dto.source;
    if (dto.stage_id !== undefined) {
      if (dto.stage_id !== null) {
        const stage = await this.prisma.crm_pipeline_stages.findFirst({
          where: { id: dto.stage_id, is_active: true },
          select: { id: true },
        });
        if (!stage) throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_001);
      }
      data.crm_stage_id = dto.stage_id;
    }
    if (dto.consents) {
      const { whatsapp, sms, email } = dto.consents;
      if (whatsapp) data.whatsapp_consent = whatsapp;
      if (sms) data.sms_consent = sms;
      if (email) data.email_consent = email;
      if (whatsapp || sms || email) data.consent_updated_at = new Date();
    }

    if (Object.keys(data).length) {
      await this.prisma.store_users.updateMany({
        where: { id: before.id },
        data,
      });
      await this.audit.log({
        userId: viewer.user_id,
        storeId: viewer.store_id,
        action: 'UPDATE',
        resource: 'customer_crm_profile',
        resourceId: customerId,
        oldValues: {
          crm_owner_user_id: before.crm_owner?.id ?? null,
          crm_source: before.crm_source,
          crm_stage_id: before.crm_stage?.id ?? null,
          whatsapp_consent: before.whatsapp_consent,
          sms_consent: before.sms_consent,
          email_consent: before.email_consent,
        },
        newValues: data as Record<string, unknown>,
        metadata: { reason: 'crm_profile_update' },
      });
    }
    return this.getProfile(customerId);
  }

  async timeline(customerId: number, query: CustomerCrmTimelineQueryDto) {
    const viewer = this.viewer();
    await this.membership(customerId);
    return this.history.getCrmTimeline(customerId, {
      types: query.types,
      before: query.before ? new Date(query.before) : undefined,
      limit: query.limit ?? 20,
      viewer,
    });
  }

  /** Replaces the customer's tags with `tagIds` (all must be of this store). */
  async setTags(customerId: number, tagIds: number[]) {
    const viewer = this.viewer();
    await this.membership(customerId);
    const wanted = [...new Set(tagIds)];
    if (wanted.length) {
      const found = await this.prisma.crm_tags.count({
        where: { id: { in: wanted } },
      });
      if (found !== wanted.length) {
        throw new VendixHttpException(ErrorCodes.CRM_TAG_001);
      }
    }
    await this.prisma.crm_customer_tags.deleteMany({
      where: { customer_id: customerId, tag_id: { notIn: wanted } },
    });
    if (wanted.length) {
      await this.prisma.crm_customer_tags.createMany({
        data: wanted.map((tagId) => ({
          store_id: viewer.store_id,
          customer_id: customerId,
          tag_id: tagId,
          created_by_user_id: viewer.user_id,
        })),
        skipDuplicates: true,
      });
    }
    return this.tagsOf(customerId);
  }

  async listNotes(customerId: number, query: CrmNotesQueryDto) {
    await this.membership(customerId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { customer_id: customerId };
    const [total, data] = await Promise.all([
      this.prisma.crm_notes.count({ where }),
      this.prisma.crm_notes.findMany({
        where,
        include: { created_by: { select: PERSON_SELECT } },
        orderBy: [{ is_pinned: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, total, page, limit };
  }

  async createNote(customerId: number, dto: CreateCrmCustomerNoteDto) {
    const viewer = this.viewer();
    await this.membership(customerId);
    return this.prisma.crm_notes.create({
      data: {
        store_id: viewer.store_id,
        customer_id: customerId,
        body: dto.body.trim(),
        is_pinned: dto.is_pinned ?? false,
        created_by_user_id: viewer.user_id,
      },
      include: { created_by: { select: PERSON_SELECT } },
    });
  }

  /** Only the author, or whoever sees the whole store, edits a note. */
  async updateNote(
    customerId: number,
    noteId: number,
    dto: UpdateCrmCustomerNoteDto,
  ) {
    const viewer = this.viewer();
    const note = await this.prisma.crm_notes.findFirst({
      where: {
        id: noteId,
        customer_id: customerId,
        ...(viewer.can_see_all ? {} : { created_by_user_id: viewer.user_id }),
      },
      select: { id: true },
    });
    if (!note) throw new VendixHttpException(ErrorCodes.CRM_NOTE_001);
    await this.prisma.crm_notes.updateMany({
      where: { id: noteId },
      data: {
        ...(dto.body !== undefined ? { body: dto.body.trim() } : {}),
        ...(dto.is_pinned !== undefined ? { is_pinned: dto.is_pinned } : {}),
      },
    });
    return this.prisma.crm_notes.findFirst({
      where: { id: noteId },
      include: { created_by: { select: PERSON_SELECT } },
    });
  }

  private viewer(): CrmViewer {
    return resolveCrmViewer(ErrorCodes.CRM_CUSTOMER_001);
  }

  /** `store_users` row of the customer in this store, or 404. */
  private async membership(customerId: number) {
    const row = await this.prisma.store_users.findFirst({
      where: { user_id: customerId },
      select: {
        id: true,
        crm_source: true,
        crm_last_contact_at: true,
        whatsapp_consent: true,
        sms_consent: true,
        email_consent: true,
        consent_updated_at: true,
        crm_owner: { select: PERSON_SELECT },
        crm_stage: {
          select: {
            id: true,
            name: true,
            kind: true,
            color: true,
            probability: true,
            pipeline_id: true,
          },
        },
      },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.CRM_CUSTOMER_001);
    return row;
  }

  private async tagsOf(customerId: number) {
    const rows = await this.prisma.crm_customer_tags.findMany({
      where: { customer_id: customerId },
      select: { tag: { select: { id: true, name: true, color: true } } },
      orderBy: { tag: { name: 'asc' } },
    });
    return rows.map((row) => row.tag);
  }

  /**
   * RFM of the customer against the store's buyers of the last
   * {@link CRM_RFM_PERIOD_DAYS} days, with the same scoring as the agent tool.
   * Without finished orders in the window there is no segment.
   */
  private async rfm(customerId: number, now: Date) {
    const since = new Date(now.getTime() - CRM_RFM_PERIOD_DAYS * DAY_MS);
    const grouped = (await this.customers.getSegmentPopulationForAgent(
      since,
    )) as Array<{
      customer_id: number | null;
      _count?: { _all?: number };
      _sum?: { grand_total?: unknown };
      _max?: { created_at?: Date | null };
    }>;
    const population = grouped
      .filter((row) => row.customer_id != null)
      .map((row) => {
        const last = row._max?.created_at ?? null;
        const spent = Number(row._sum?.grand_total ?? 0);
        return {
          customer_id: row.customer_id as number,
          orders: row._count?._all ?? 0,
          spent: Number.isFinite(spent) ? spent : 0,
          last_purchase_at: last,
          recency_days: last
            ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY_MS))
            : CRM_RFM_PERIOD_DAYS,
        };
      });
    const own = population.find((row) => row.customer_id === customerId);
    if (!own) {
      return {
        period_days: CRM_RFM_PERIOD_DAYS,
        recency_days: null,
        frequency: 0,
        monetary: '0',
        last_purchase_at: null,
        scores: null,
        segment: null,
        description: null,
      };
    }
    const scores = rfmScores(
      {
        recency: population.map((row) => row.recency_days).sort((a, b) => a - b),
        frequency: population.map((row) => row.orders).sort((a, b) => a - b),
        monetary: population.map((row) => row.spent).sort((a, b) => a - b),
      },
      own.recency_days,
      own.orders,
      own.spent,
    );
    const segment = rfmSegment(scores.r, scores.f, scores.m);
    return {
      period_days: CRM_RFM_PERIOD_DAYS,
      recency_days: own.recency_days,
      frequency: own.orders,
      monetary: own.spent.toFixed(2),
      last_purchase_at: own.last_purchase_at,
      scores,
      segment,
      description: RFM_DEFINITIONS[segment] ?? null,
    };
  }
}
