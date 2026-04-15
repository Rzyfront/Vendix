import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ReservationsService } from '../reservations/reservations.service';
import { SubmissionsService } from '../data-collection/submissions.service';

@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly reservationsService: ReservationsService,
    private readonly submissionsService: SubmissionsService,
  ) {}

  /**
   * Get today's consultations (bookings where product.is_consultation = true)
   */
  async getTodayConsultations(date?: string) {
    const targetDate = date ? new Date(date + 'T00:00:00') : new Date();
    // Normalize to date-only (strip time)
    const dateOnly = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
    );

    const bookings = await this.prisma.bookings.findMany({
      where: {
        date: dateOnly,
        product: { is_consultation: true },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            service_duration_minutes: true,
          },
        },
        customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
          },
        },
        provider: {
          select: {
            id: true,
            display_name: true,
          },
        },
        data_collection_submissions: {
          select: {
            id: true,
            status: true,
            ai_prediagnosis: true,
          },
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
      orderBy: { start_time: 'asc' },
    });

    return bookings.map((b: any) => ({
      ...b,
      submission: b.data_collection_submissions?.[0] ?? null,
      data_collection_submissions: undefined,
    }));
  }

  /**
   * Get full consultation context for a booking
   */
  async getConsultationContext(bookingId: number) {
    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            service_duration_minutes: true,
            service_instructions: true,
            is_consultation: true,
            consultation_template_id: true,
            preconsultation_template_id: true,
          },
        },
        customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            document_type: true,
            document_number: true,
          },
        },
        provider: {
          select: {
            id: true,
            display_name: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Reserva no encontrada');
    }

    if (!booking.product?.is_consultation) {
      throw new BadRequestException('Esta reserva no es una consulta');
    }

    // Load preconsultation submission (patient data)
    const submission = await this.submissionsService.getSubmissionByBooking(bookingId);

    // Load the consultation template (provider's template) separately from product
    let consultationTemplate = null;
    if ((booking.product as any).consultation_template_id) {
      consultationTemplate = await this.prisma.data_collection_templates.findUnique({
        where: { id: (booking.product as any).consultation_template_id },
        include: {
          tabs: {
            include: {
              sections: {
                include: {
                  items: { include: { metadata_field: true }, orderBy: { sort_order: 'asc' as const } },
                  child_sections: {
                    include: { items: { include: { metadata_field: true }, orderBy: { sort_order: 'asc' as const } } },
                    orderBy: { sort_order: 'asc' as const },
                  },
                },
                where: { parent_section_id: null },
                orderBy: { sort_order: 'asc' as const },
              },
            },
            orderBy: { sort_order: 'asc' as const },
          },
          sections: {
            include: {
              items: { include: { metadata_field: true }, orderBy: { sort_order: 'asc' as const } },
              child_sections: {
                include: { items: { include: { metadata_field: true }, orderBy: { sort_order: 'asc' as const } } },
                orderBy: { sort_order: 'asc' as const },
              },
            },
            where: { tab_id: null, parent_section_id: null },
            orderBy: { sort_order: 'asc' as const },
          },
        },
      });
    }

    // Load existing consultation notes for this booking
    const consultationNotes = await this.prisma.customer_consultation_notes.findMany({
      where: { booking_id: bookingId },
      orderBy: { created_at: 'asc' },
    });

    // Load customer history
    const customerHistory = await this.getCustomerHistory(
      booking.customer_id,
      bookingId,
    );

    return {
      booking: {
        id: booking.id,
        booking_number: booking.booking_number,
        date: booking.date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        status: booking.status,
        checked_in_at: booking.checked_in_at,
        notes: booking.notes,
        internal_notes: booking.internal_notes,
      },
      product: {
        id: booking.product.id,
        name: booking.product.name,
        service_duration_minutes: booking.product.service_duration_minutes,
        service_instructions: booking.product.service_instructions,
      },
      customer: {
        id: booking.customer.id,
        first_name: booking.customer.first_name,
        last_name: booking.customer.last_name,
        document_type: booking.customer.document_type,
        document_number: booking.customer.document_number,
      },
      provider: booking.provider
        ? { id: booking.provider.id, display_name: booking.provider.display_name }
        : null,
      consultation_template: consultationTemplate,
      preconsultation_template: submission?.template ?? null,
      preconsultation_submission: submission
        ? {
            id: submission.id,
            status: submission.status,
            ai_prediagnosis: submission.ai_prediagnosis,
            responses: submission.responses ?? [],
          }
        : null,
      consultation_notes: consultationNotes,
      customer_history: customerHistory,
    };
  }

  /**
   * Save consultation notes for a booking
   */
  async saveConsultationNotes(
    bookingId: number,
    notes: { note_key: string; note_value: string; include_in_summary?: boolean }[],
  ) {
    const context = RequestContextService.getContext();
    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId },
      select: { id: true, store_id: true, customer_id: true },
    });

    if (!booking) {
      throw new NotFoundException('Reserva no encontrada');
    }

    const results: any[] = [];

    for (const note of notes) {
      // Find existing note by booking_id + note_key to simulate upsert
      const existing = await this.prisma.customer_consultation_notes.findFirst({
        where: { booking_id: bookingId, note_key: note.note_key },
      });

      if (existing) {
        const updated = await this.prisma.customer_consultation_notes.update({
          where: { id: existing.id },
          data: {
            note_value: note.note_value,
            include_in_summary: note.include_in_summary ?? existing.include_in_summary,
            updated_at: new Date(),
          },
        });
        results.push(updated);
      } else {
        const created = await this.prisma.customer_consultation_notes.create({
          data: {
            store_id: booking.store_id,
            customer_id: booking.customer_id,
            booking_id: bookingId,
            note_key: note.note_key,
            note_value: note.note_value,
            include_in_summary: note.include_in_summary ?? false,
            created_by_id: context?.user_id ?? null,
          },
        });
        results.push(created);
      }
    }

    return results;
  }

  /**
   * Save provider responses during consultation
   */
  async saveProviderResponses(
    bookingId: number,
    responses: {
      field_id: number;
      value_text?: string;
      value_number?: number;
      value_bool?: boolean;
      value_date?: string;
      value_json?: any;
    }[],
  ) {
    // Load or create submission for this booking
    let submission = await this.submissionsService.getSubmissionByBooking(bookingId);

    if (!submission) {
      // Load booking to find the product's consultation template
      const booking = await this.prisma.bookings.findFirst({
        where: { id: bookingId },
        include: {
          product: { select: { consultation_template_id: true } },
        },
      });

      if (!booking) {
        throw new NotFoundException('Reserva no encontrada');
      }

      if (!booking.product?.consultation_template_id) {
        throw new BadRequestException(
          'El servicio no tiene una plantilla de consulta configurada',
        );
      }

      submission = await this.submissionsService.createSubmission({
        template_id: booking.product.consultation_template_id,
        booking_id: bookingId,
        customer_id: booking.customer_id,
      });
    }

    // Upsert responses
    for (const resp of responses) {
      await this.prisma.withoutScope().data_collection_responses.upsert({
        where: {
          submission_id_field_id: {
            submission_id: submission.id,
            field_id: resp.field_id,
          },
        },
        create: {
          submission_id: submission.id,
          field_id: resp.field_id,
          value_text: resp.value_text,
          value_number: resp.value_number,
          value_date: resp.value_date ? new Date(resp.value_date) : undefined,
          value_bool: resp.value_bool,
          value_json: resp.value_json ?? undefined,
        },
        update: {
          value_text: resp.value_text,
          value_number: resp.value_number,
          value_date: resp.value_date ? new Date(resp.value_date) : undefined,
          value_bool: resp.value_bool,
          value_json: resp.value_json ?? undefined,
          updated_at: new Date(),
        },
      });
    }

    return { success: true, submission_id: submission.id, responses_saved: responses.length };
  }

  /**
   * Check-in a booking (delegate to ReservationsService)
   */
  async checkIn(bookingId: number) {
    return this.reservationsService.checkIn(bookingId, 'staff');
  }

  /**
   * Start a consultation (delegate to ReservationsService)
   */
  async startConsultation(bookingId: number) {
    return this.reservationsService.start(bookingId);
  }

  /**
   * Complete a consultation (delegate to ReservationsService)
   */
  async completeConsultation(bookingId: number) {
    return this.reservationsService.complete(bookingId);
  }

  /**
   * Get customer history: previous completed bookings + important notes
   */
  private async getCustomerHistory(customerId: number, currentBookingId: number) {
    const previousBookings = await this.prisma.bookings.findMany({
      where: {
        customer_id: customerId,
        status: 'completed',
        id: { not: currentBookingId },
      },
      include: {
        product: { select: { id: true, name: true } },
        provider: { select: { id: true, display_name: true } },
      },
      orderBy: { date: 'desc' },
      take: 10,
    });

    const importantNotes = await this.prisma.customer_consultation_notes.findMany({
      where: {
        customer_id: customerId,
        include_in_summary: true,
        booking_id: { not: currentBookingId },
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    return {
      previous_bookings: previousBookings.map((b: any) => ({
        id: b.id,
        booking_number: b.booking_number,
        date: b.date,
        start_time: b.start_time,
        product_name: b.product?.name,
        provider_name: b.provider?.display_name,
      })),
      important_notes: importantNotes,
    };
  }
}
