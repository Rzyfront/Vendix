import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { MetadataValuesService } from '../../metadata/metadata-values.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

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
      has_intake_data: b.data_collection_submissions?.length > 0 && b.data_collection_submissions[0].status !== 'pending',
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
          select: { id: true, booking_number: true, date: true, product: { select: { name: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async addNote(customerId: number, bookingId: number, noteKey: string, noteValue: string, createdById?: number) {
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
      data: { include_in_summary: !note.include_in_summary, updated_at: new Date() },
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
}
