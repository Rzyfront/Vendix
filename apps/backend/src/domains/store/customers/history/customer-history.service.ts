import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { MetadataValuesService } from '../../metadata/metadata-values.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

/** Sources of the CRM timeline (PLAN-CRM §4.4). */
export const CRM_TIMELINE_TYPES = [
  'order',
  'payment',
  'quotation',
  'booking',
  'message',
  'task',
  'note',
] as const;
export type CrmTimelineType = (typeof CRM_TIMELINE_TYPES)[number];

export interface CrmTimelinePerson {
  id: number;
  first_name: string | null;
  last_name: string | null;
}

export interface CrmTimelineItem {
  type: CrmTimelineType;
  at: Date;
  title: string;
  summary: string | null;
  status: string | null;
  amount: string | null;
  currency: string | null;
  ref: { kind: CrmTimelineType; id: number };
  actor: CrmTimelinePerson | null;
}

export interface CrmTimelineOptions {
  types?: CrmTimelineType[];
  before?: Date;
  limit: number;
  /** Seller/cashier: only messages and tasks assigned to them (DECISIONES §6). */
  viewer: { user_id: number; can_see_all: boolean };
}

const TIMELINE_PERSON = { id: true, first_name: true, last_name: true } as const;
const TIMELINE_SUMMARY_LENGTH = 160;

@Injectable()
export class CustomerHistoryService {
  private readonly logger = new Logger(CustomerHistoryService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly metadataValues: MetadataValuesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getTimeline(customerId: number, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      this.prisma.bookings.findMany({
        where: { customer_id: customerId },
        include: {
          product: { select: { id: true, name: true } },
          provider: { select: { id: true, display_name: true } },
          data_collection_submissions: {
            select: { id: true, status: true, ai_prediagnosis: true },
            take: 1,
            orderBy: { created_at: 'desc' as const },
          },
          metadata_snapshot: { select: { id: true } },
          consultation_notes: { select: { id: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.bookings.count({ where: { customer_id: customerId } }),
    ]);

    const data = bookings.map((b: any) => ({
      id: b.id,
      booking_number: b.booking_number,
      date: b.date,
      start_time: b.start_time,
      end_time: b.end_time,
      status: b.status,
      product: b.product,
      provider: b.provider,
      has_intake_data:
        b.data_collection_submissions?.length > 0 &&
        b.data_collection_submissions[0].status !== 'pending',
      has_prediagnosis: !!b.data_collection_submissions?.[0]?.ai_prediagnosis,
      notes_count: b.consultation_notes?.length ?? 0,
      has_snapshot: !!b.metadata_snapshot,
    }));

    return {
      data,
      meta: { total, page, limit, total_pages: Math.ceil(total / limit) },
    };
  }

  async getBookingDetail(customerId: number, bookingId: number) {
    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId, customer_id: customerId },
      include: {
        product: { select: { id: true, name: true } },
        provider: { select: { id: true, display_name: true } },
        data_collection_submissions: {
          select: { id: true, status: true, ai_prediagnosis: true },
          take: 1,
          orderBy: { created_at: 'desc' as const },
        },
        metadata_snapshot: true,
        consultation_notes: {
          orderBy: { created_at: 'desc' as const },
        },
      },
    });

    if (!booking) throw new VendixHttpException(ErrorCodes.CUST_HISTORY_002);
    return booking;
  }

  async getSummaryNotes(customerId: number) {
    return this.prisma.customer_consultation_notes.findMany({
      where: { customer_id: customerId, include_in_summary: true },
      include: {
        booking: {
          select: {
            id: true,
            booking_number: true,
            date: true,
            product: { select: { name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async addNote(
    customerId: number,
    bookingId: number,
    noteKey: string,
    noteValue: string,
    createdById?: number,
  ) {
    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId, customer_id: customerId },
    });
    if (!booking) throw new VendixHttpException(ErrorCodes.CUST_HISTORY_002);

    return this.prisma.customer_consultation_notes.create({
      data: {
        customer_id: customerId,
        booking_id: bookingId,
        note_key: noteKey,
        note_value: noteValue,
        created_by_id: createdById,
      },
    });
  }

  async toggleNoteSummary(noteId: number) {
    const note = await this.prisma.customer_consultation_notes.findUnique({
      where: { id: noteId },
    });
    if (!note) throw new VendixHttpException(ErrorCodes.CUST_HISTORY_003);

    return this.prisma.customer_consultation_notes.update({
      where: { id: noteId },
      data: {
        include_in_summary: !note.include_in_summary,
        updated_at: new Date(),
      },
    });
  }

  async getFullContext(customerId: number) {
    const [customerMetadata, summaryNotes, recentBookings] = await Promise.all([
      this.metadataValues.getValues('customer', customerId),
      this.getSummaryNotes(customerId),
      this.prisma.bookings.findMany({
        where: { customer_id: customerId },
        include: { product: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 5,
      }),
    ]);

    return {
      customer_metadata: customerMetadata,
      summary_notes: summaryNotes,
      recent_bookings: recentBookings,
    };
  }

  /**
   * CRM timeline of one customer (PLAN-CRM §4.4): orders, payments,
   * quotations, bookings, inbox messages, CRM tasks and CRM notes, newest
   * first. Each source reads at most `limit` rows older than `before`, so the
   * merged page is exact and `next_before` continues it. Rows that share the
   * exact boundary timestamp with the last item of a page can be skipped:
   * acceptable for a human-paced feed.
   *
   * Every query goes through `StorePrismaService`, so another store's rows are
   * never read. `getTimeline` (bookings only) keeps its contract.
   */
  async getCrmTimeline(customerId: number, options: CrmTimelineOptions) {
    const types = new Set<CrmTimelineType>(
      options.types?.length ? options.types : CRM_TIMELINE_TYPES,
    );
    const take = options.limit;
    const createdBefore = options.before
      ? { created_at: { lt: options.before } }
      : { created_at: { not: null } };
    const ownOnly = !options.viewer.can_see_all;
    const me = options.viewer.user_id;
    const none = Promise.resolve([] as CrmTimelineItem[]);

    const sources: Promise<CrmTimelineItem[]>[] = [
      types.has('order')
        ? this.prisma.orders
            .findMany({
              where: { customer_id: customerId, ...createdBefore },
              select: {
                id: true,
                order_number: true,
                grand_total: true,
                currency: true,
                state: true,
                channel: true,
                created_at: true,
              },
              orderBy: { created_at: 'desc' },
              take,
            })
            .then((rows) =>
              rows.map((row) => ({
                type: 'order' as const,
                at: row.created_at as Date,
                title: `Pedido ${row.order_number}`,
                summary: `Canal: ${row.channel}`,
                status: row.state,
                amount: row.grand_total?.toString() ?? null,
                currency: row.currency,
                ref: { kind: 'order' as const, id: row.id },
                actor: null,
              })),
            )
        : none,
      types.has('payment')
        ? this.prisma.payments
            .findMany({
              where: { orders: { customer_id: customerId }, ...createdBefore },
              select: {
                id: true,
                amount: true,
                currency: true,
                state: true,
                created_at: true,
                orders: { select: { id: true, order_number: true } },
              },
              orderBy: { created_at: 'desc' },
              take,
            })
            .then((rows) =>
              rows.map((row) => ({
                type: 'payment' as const,
                at: row.created_at as Date,
                title: `Pago del pedido ${row.orders?.order_number ?? ''}`.trim(),
                summary: null,
                status: row.state,
                amount: row.amount?.toString() ?? null,
                currency: row.currency,
                ref: { kind: 'payment' as const, id: row.id },
                actor: null,
              })),
            )
        : none,
      types.has('quotation')
        ? this.prisma.quotations
            .findMany({
              where: { customer_id: customerId, ...createdBefore },
              select: {
                id: true,
                quotation_number: true,
                grand_total: true,
                status: true,
                valid_until: true,
                created_at: true,
              },
              orderBy: { created_at: 'desc' },
              take,
            })
            .then((rows) =>
              rows.map((row) => ({
                type: 'quotation' as const,
                at: row.created_at as Date,
                title: `Cotización ${row.quotation_number}`,
                summary: null,
                status: row.status,
                amount: row.grand_total?.toString() ?? null,
                currency: null,
                ref: { kind: 'quotation' as const, id: row.id },
                actor: null,
              })),
            )
        : none,
      types.has('booking')
        ? this.prisma.bookings
            .findMany({
              where: { customer_id: customerId, ...createdBefore },
              select: {
                id: true,
                booking_number: true,
                date: true,
                start_time: true,
                status: true,
                created_at: true,
                product: { select: { name: true } },
              },
              orderBy: { created_at: 'desc' },
              take,
            })
            .then((rows) =>
              rows.map((row) => ({
                type: 'booking' as const,
                at: row.created_at as Date,
                title: `Reserva ${row.booking_number}`,
                summary: [
                  row.product?.name,
                  `${row.date.toISOString().slice(0, 10)} ${row.start_time}`,
                ]
                  .filter(Boolean)
                  .join(' · '),
                status: row.status,
                amount: null,
                currency: null,
                ref: { kind: 'booking' as const, id: row.id },
                actor: null,
              })),
            )
        : none,
      types.has('message')
        ? this.prisma.crm_messages
            .findMany({
              where: {
                ...createdBefore,
                conversation: {
                  customer_id: customerId,
                  ...(ownOnly ? { assigned_user_id: me } : {}),
                },
              },
              select: {
                id: true,
                conversation_id: true,
                direction: true,
                channel: true,
                status: true,
                body: true,
                template_name: true,
                created_at: true,
                sent_by: { select: TIMELINE_PERSON },
              },
              orderBy: { created_at: 'desc' },
              take,
            })
            .then((rows) =>
              rows.map((row) => ({
                type: 'message' as const,
                at: row.created_at,
                title:
                  row.channel === 'internal_note'
                    ? 'Nota interna en la bandeja'
                    : `${row.direction === 'inbound' ? 'Mensaje recibido' : 'Mensaje enviado'} por ${row.channel}`,
                summary: row.body
                  ? row.body.slice(0, TIMELINE_SUMMARY_LENGTH)
                  : row.template_name
                    ? `[plantilla] ${row.template_name}`
                    : null,
                status: row.status,
                amount: null,
                currency: null,
                // The inbox opens a conversation, not a message.
                ref: { kind: 'message' as const, id: row.conversation_id },
                actor: row.sent_by,
              })),
            )
        : none,
      types.has('task')
        ? this.prisma.crm_tasks
            .findMany({
              where: {
                customer_id: customerId,
                ...createdBefore,
                ...(ownOnly
                  ? { OR: [{ assigned_user_id: me }, { created_by_user_id: me }] }
                  : {}),
              },
              select: {
                id: true,
                title: true,
                status: true,
                due_at: true,
                created_at: true,
                assigned_user: { select: TIMELINE_PERSON },
                created_by: { select: TIMELINE_PERSON },
              },
              orderBy: { created_at: 'desc' },
              take,
            })
            .then((rows) =>
              rows.map((row) => ({
                type: 'task' as const,
                at: row.created_at,
                title: row.title,
                summary: row.due_at
                  ? `Vence ${row.due_at.toISOString()}`
                  : null,
                status: row.status,
                amount: null,
                currency: null,
                ref: { kind: 'task' as const, id: row.id },
                actor: row.created_by,
              })),
            )
        : none,
      types.has('note')
        ? this.prisma.crm_notes
            .findMany({
              where: { customer_id: customerId, ...createdBefore },
              select: {
                id: true,
                body: true,
                is_pinned: true,
                created_at: true,
                created_by: { select: TIMELINE_PERSON },
              },
              orderBy: { created_at: 'desc' },
              take,
            })
            .then((rows) =>
              rows.map((row) => ({
                type: 'note' as const,
                at: row.created_at,
                title: row.is_pinned ? 'Nota fijada' : 'Nota',
                summary: row.body,
                status: null,
                amount: null,
                currency: null,
                ref: { kind: 'note' as const, id: row.id },
                actor: row.created_by,
              })),
            )
        : none,
    ];

    const results = await Promise.all(sources);
    const merged = results
      .flat()
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    const data = merged.slice(0, take);
    // A source that filled its `take` may still hold older rows.
    const hasMore =
      merged.length > take || results.some((rows) => rows.length === take);
    return {
      data,
      meta: {
        has_more: hasMore,
        next_before: hasMore ? data[data.length - 1].at.toISOString() : null,
      },
    };
  }
}
