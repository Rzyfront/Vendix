import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { booking_status_enum } from '@prisma/client';

export interface AvailabilitySlot {
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  reserved: number;
  available: number;
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Genera los slots disponibles para un producto/servicio en un rango de fechas
   */
  async getAvailableSlots(
    product_id: number,
    date_from: string,
    date_to: string,
  ): Promise<AvailabilitySlot[]> {
    // 1. Obtener horarios activos del servicio
    const schedules = await this.prisma.service_schedules.findMany({
      where: { product_id, is_active: true },
    });

    if (schedules.length === 0) return [];

    // 2. Obtener excepciones en el rango de fechas
    const exceptions = await this.prisma.schedule_exceptions.findMany({
      where: {
        OR: [{ product_id }, { product_id: null }],
        date: {
          gte: new Date(date_from),
          lte: new Date(date_to),
        },
      },
    });

    // 3. Obtener reservas existentes en el rango (no canceladas)
    const existingBookings = await this.prisma.bookings.findMany({
      where: {
        product_id,
        date: {
          gte: new Date(date_from),
          lte: new Date(date_to),
        },
        status: { notIn: [booking_status_enum.cancelled] },
      },
      select: { date: true, start_time: true, end_time: true },
    });

    const slots: AvailabilitySlot[] = [];
    const dates = this.getDatesInRange(date_from, date_to);

    for (const currentDate of dates) {
      const dayOfWeek = currentDate.getUTCDay(); // 0=Sunday, 6=Saturday
      const dateStr = this.formatDate(currentDate);

      // Buscar schedule para este dia de la semana
      const schedule = schedules.find((s) => s.day_of_week === dayOfWeek);
      if (!schedule) continue;

      // Verificar excepciones para este dia
      const exception = exceptions.find(
        (e) => this.formatDate(new Date(e.date)) === dateStr,
      );

      // Si hay excepcion y esta cerrado, saltar
      if (exception?.is_closed) continue;

      // Determinar horario efectivo (excepcion override o schedule por defecto)
      const effectiveStart = exception?.custom_start_time || schedule.start_time;
      const effectiveEnd = exception?.custom_end_time || schedule.end_time;
      const effectiveCapacity = exception?.custom_capacity ?? schedule.capacity;

      // Generar time slots
      const timeSlots = this.generateTimeSlots(
        effectiveStart,
        effectiveEnd,
        schedule.slot_duration_minutes,
        schedule.buffer_minutes,
      );

      for (const slot of timeSlots) {
        // Contar reservas existentes para este slot exacto
        const reserved = existingBookings.filter(
          (b) =>
            this.formatDate(new Date(b.date)) === dateStr &&
            b.start_time === slot.start_time &&
            b.end_time === slot.end_time,
        ).length;

        const available = effectiveCapacity - reserved;
        if (available > 0) {
          slots.push({
            date: dateStr,
            start_time: slot.start_time,
            end_time: slot.end_time,
            capacity: effectiveCapacity,
            reserved,
            available,
          });
        }
      }
    }

    return slots;
  }

  /**
   * Verifica si un slot especifico esta disponible
   */
  async isSlotAvailable(
    product_id: number,
    date: string,
    start_time: string,
    end_time: string,
  ): Promise<boolean> {
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getUTCDay();

    // Buscar schedule para ese dia
    const schedule = await this.prisma.service_schedules.findFirst({
      where: { product_id, day_of_week: dayOfWeek, is_active: true },
    });

    if (!schedule) return false;

    // Verificar excepciones
    const exception = await this.prisma.schedule_exceptions.findFirst({
      where: {
        OR: [{ product_id }, { product_id: null }],
        date: targetDate,
      },
    });

    if (exception?.is_closed) return false;

    const effectiveCapacity = exception?.custom_capacity ?? schedule.capacity;

    // Contar reservas existentes para este slot
    const reservedCount = await this.prisma.bookings.count({
      where: {
        product_id,
        date: targetDate,
        start_time,
        end_time,
        status: { notIn: [booking_status_enum.cancelled] },
      },
    });

    return reservedCount < effectiveCapacity;
  }

  /**
   * Valida que el cliente no tenga reservas superpuestas
   */
  async validateNoOverlapForCustomer(
    customer_id: number,
    date: string,
    start_time: string,
    end_time: string,
    exclude_booking_id?: number,
  ): Promise<void> {
    const targetDate = new Date(date);
    const requestedStart = this.timeToMinutes(start_time);
    const requestedEnd = this.timeToMinutes(end_time);

    const activeStatuses = [
      booking_status_enum.pending,
      booking_status_enum.confirmed,
      booking_status_enum.in_progress,
    ];

    const where: any = {
      customer_id,
      date: targetDate,
      status: { in: activeStatuses },
    };

    if (exclude_booking_id) {
      where.id = { not: exclude_booking_id };
    }

    const customerBookings = await this.prisma.bookings.findMany({
      where,
      select: { start_time: true, end_time: true, booking_number: true },
    });

    for (const booking of customerBookings) {
      const existingStart = this.timeToMinutes(booking.start_time);
      const existingEnd = this.timeToMinutes(booking.end_time);

      // Verificar superposicion: dos rangos se superponen si start < otherEnd && end > otherStart
      if (requestedStart < existingEnd && requestedEnd > existingStart) {
        throw new BadRequestException(
          `El cliente ya tiene una reserva (${booking.booking_number}) que se superpone con el horario solicitado`,
        );
      }
    }
  }

  // --- Helpers privados ---

  private generateTimeSlots(
    start: string,
    end: string,
    duration: number,
    buffer: number,
  ): Array<{ start_time: string; end_time: string }> {
    const slots: Array<{ start_time: string; end_time: string }> = [];
    let current = this.timeToMinutes(start);
    const endMinutes = this.timeToMinutes(end);

    while (current + duration <= endMinutes) {
      const slot_start = this.minutesToTime(current);
      const slot_end = this.minutesToTime(current + duration);
      slots.push({ start_time: slot_start, end_time: slot_end });
      current += duration + buffer;
    }

    return slots;
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  private minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60).toString().padStart(2, '0');
    const m = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  private getDatesInRange(from: string, to: string): Date[] {
    const dates: Date[] = [];
    const current = new Date(from);
    const end = new Date(to);
    while (current <= end) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }

  private formatDate(date: Date): string {
    const y = date.getUTCFullYear();
    const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = date.getUTCDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
