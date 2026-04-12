import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { booking_status_enum, booking_mode_enum, Prisma } from '@prisma/client';
import {
  CreateBookingDto,
  RescheduleBookingDto,
  BookingQueryDto,
  CalendarQueryDto,
} from './dto';
import { AvailabilityService } from './availability.service';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly availabilityService: AvailabilityService,
    private readonly ordersService: OrdersService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Estado maquina de transiciones validas
  private readonly VALID_TRANSITIONS: Record<string, string[]> = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['in_progress', 'completed', 'cancelled', 'no_show'],
    in_progress: ['completed'],
    completed: [],
    cancelled: [],
    no_show: [],
  };

  private readonly BOOKING_INCLUDE = {
    customer: {
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
      },
    },
    product: {
      select: {
        id: true,
        name: true,
        service_duration_minutes: true,
        base_price: true,
        product_images: {
          where: { is_main: true },
          select: { image_url: true },
          take: 1,
        },
      },
    },
    provider: {
      select: {
        id: true,
        display_name: true,
        avatar_url: true,
        employee: { select: { first_name: true, last_name: true } },
      },
    },
    created_by: {
      select: { id: true, first_name: true, last_name: true },
    },
    order: {
      select: { id: true, order_number: true },
    },
  };

  /**
   * Normaliza un booking: extrae image_url de product_images al nivel de product
   */
  private mapBooking(booking: any) {
    if (booking?.product?.product_images) {
      const mainImage = booking.product.product_images[0];
      booking.product.image_url = mainImage?.image_url || null;
      delete booking.product.product_images;
    }
    return booking;
  }

  private mapBookings(bookings: any[]) {
    return bookings.map((b) => this.mapBooking(b));
  }

  /**
   * Crea una nueva reserva
   */
  async create(dto: CreateBookingDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new BadRequestException('No se encontro contexto de tienda');
    }

    // 1. Validar que el producto existe y requiere reserva
    const product = await this.prisma.products.findFirst({
      where: { id: dto.product_id },
      select: {
        id: true,
        name: true,
        requires_booking: true,
        service_duration_minutes: true,
        booking_mode: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto/servicio no encontrado');
    }

    if (!product.requires_booking) {
      throw new BadRequestException(
        'Este producto/servicio no requiere reserva',
      );
    }

    // 2. Resolver provider_id
    let resolvedProviderId: number | null = dto.provider_id ?? null;

    if (dto.provider_id) {
      // Validar que el provider existe y ofrece este servicio
      const providerAssignment = await this.prisma.provider_services.findFirst({
        where: { provider_id: dto.provider_id, product_id: dto.product_id },
        include: { provider: { select: { id: true, is_active: true } } },
      });

      if (!providerAssignment || !providerAssignment.provider.is_active) {
        throw new BadRequestException(
          'El proveedor especificado no ofrece este servicio o no esta activo',
        );
      }
    } else if (
      product.booking_mode === booking_mode_enum.provider_required &&
      !dto.skip_availability_check
    ) {
      // Check if there are ANY providers for this service
      const serviceProviders = await this.prisma.provider_services.findMany({
        where: { product_id: dto.product_id },
        include: { provider: { select: { id: true, is_active: true } } },
      });

      const activeProviders = serviceProviders.filter(
        (sp) => sp.provider.is_active,
      );

      if (activeProviders.length > 0) {
        // Auto-asignar el primer provider disponible
        const availableProviders =
          await this.availabilityService.getAvailableProvidersForSlot(
            dto.product_id,
            dto.date,
            dto.start_time,
            dto.end_time,
          );

        if (availableProviders.length > 0) {
          resolvedProviderId = availableProviders[0].id;
        }
        // If no available providers for this slot but providers exist, we'll validate below
      }
      // If NO providers configured at all, skip provider validation (fallback)
    }

    // 3. Validar disponibilidad del slot (a menos que se indique lo contrario)
    const isFreeBooking =
      product.booking_mode === booking_mode_enum.free_booking;
    const noProvidersConfigured = !resolvedProviderId && !dto.provider_id;
    const shouldSkipAvailability =
      dto.skip_availability_check || isFreeBooking || noProvidersConfigured;

    if (!shouldSkipAvailability) {
      const isAvailable = await this.availabilityService.isSlotAvailable(
        dto.product_id,
        dto.date,
        dto.start_time,
        dto.end_time,
        resolvedProviderId ?? undefined,
      );

      if (!isAvailable) {
        throw new ConflictException('El horario solicitado no esta disponible');
      }
    }

    // 4. Validar que el cliente no tenga reservas superpuestas
    await this.availabilityService.validateNoOverlapForCustomer(
      dto.customer_id,
      dto.date,
      dto.start_time,
      dto.end_time,
    );

    // 5. Generar numero de reserva
    const booking_number = await this.generateBookingNumber(store_id, dto.date);

    // 6. Crear reserva con transaccion serializable para prevenir condiciones de carrera
    const booking = await this.prisma.$transaction(
      async (tx) => {
        // Re-verificar disponibilidad dentro de la transaccion (si aplica)
        if (!shouldSkipAvailability && resolvedProviderId) {
          const providerBooked = await tx.bookings.count({
            where: {
              provider_id: resolvedProviderId,
              date: new Date(dto.date),
              start_time: dto.start_time,
              end_time: dto.end_time,
              status: { notIn: [booking_status_enum.cancelled] },
            },
          });

          if (providerBooked > 0) {
            throw new ConflictException(
              'El horario ya no esta disponible (reservado por otro usuario)',
            );
          }
        }

        const created = await tx.bookings.create({
          data: {
            store_id,
            customer_id: dto.customer_id,
            product_id: dto.product_id,
            booking_number,
            date: new Date(dto.date),
            start_time: dto.start_time,
            end_time: dto.end_time,
            status: booking_status_enum.pending,
            channel: dto.channel || 'pos',
            notes: dto.notes,
            order_id: dto.order_id,
            provider_id: resolvedProviderId,
            created_by_user_id: context?.user_id,
            updated_at: new Date(),
          },
          include: this.BOOKING_INCLUDE,
        });
        return this.mapBooking(created);
      },
      { isolationLevel: 'Serializable' },
    );

    // 7. Auto-crear orden de venta vinculada
    if (!dto.order_id && !dto.skip_order_creation) {
      try {
        const price = Number(booking.product?.base_price) || 0;
        const order = await this.ordersService.create(
          {
            customer_id: dto.customer_id,
            items: [
              {
                product_id: dto.product_id,
                product_name: booking.product?.name || 'Servicio',
                quantity: 1,
                unit_price: price,
                total_price: price,
              },
            ],
            subtotal: price,
            total_amount: price,
            internal_notes: `Generada desde reserva ${booking.booking_number}`,
            channel: dto.channel || 'pos',
            skip_schedule_validation: true,
          } as any,
          context?.user_id,
        );

        await this.prisma.bookings.update({
          where: { id: booking.id },
          data: { order_id: order.id, updated_at: new Date() },
        });
        booking.order = { id: order.id, order_number: order.order_number };
      } catch (error) {
        this.logger.warn(
          `No se pudo crear orden para reserva ${booking.booking_number}: ${error.message}`,
        );
      }
    }

    // 8. Emitir evento
    this.eventEmitter.emit('booking.created', {
      store_id,
      booking_id: booking.id,
      booking_number: booking.booking_number,
      customer_name: `${booking.customer.first_name} ${booking.customer.last_name}`,
      service_name: booking.product.name,
      date: dto.date,
      start_time: dto.start_time,
      channel: dto.channel || 'pos',
    });

    return booking;
  }

  async hold(dto: {
    customer_id: number;
    product_id: number;
    date: string;
    start_time: string;
    end_time: string;
    notes?: string;
  }) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new BadRequestException('No se encontro contexto de tienda');
    }

    const product = await this.prisma.products.findFirst({
      where: { id: dto.product_id },
      select: {
        id: true,
        name: true,
        requires_booking: true,
        booking_mode: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto/servicio no encontrado');
    }

    if (!product.requires_booking) {
      throw new BadRequestException(
        'Este producto/servicio no requiere reserva',
      );
    }

    const isFreeBooking =
      product.booking_mode === booking_mode_enum.free_booking;

    if (!isFreeBooking) {
      const isAvailable = await this.availabilityService.isSlotAvailable(
        dto.product_id,
        dto.date,
        dto.start_time,
        dto.end_time,
      );
      if (!isAvailable) {
        throw new ConflictException('El horario solicitado no esta disponible');
      }
    }

    const HOLD_DURATION_MINUTES = 15;
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + HOLD_DURATION_MINUTES);

    const booking_number = await this.generateBookingNumber(store_id, dto.date);

    const booking = await this.prisma.bookings.create({
      data: {
        store_id,
        customer_id: dto.customer_id,
        product_id: dto.product_id,
        booking_number,
        date: new Date(dto.date),
        start_time: dto.start_time,
        end_time: dto.end_time,
        status: booking_status_enum.pending,
        channel: 'ecommerce',
        notes: dto.notes,
        expires_at: expiresAt,
        created_by_user_id: context?.user_id,
        updated_at: new Date(),
      },
      include: this.BOOKING_INCLUDE,
    });

    return this.mapBooking(booking);
  }

  async confirmHold(id: number) {
    const booking = await this.findOne(id);

    if (booking.expires_at && new Date(booking.expires_at) < new Date()) {
      await this.prisma.bookings.delete({ where: { id } });
      throw new BadRequestException(
        'La reserva temporal ha expirado. Por favor selecciona un horario nuevamente.',
      );
    }

    const updated = this.mapBooking(
      await this.prisma.bookings.update({
        where: { id },
        data: {
          expires_at: null,
          updated_at: new Date(),
        },
        include: this.BOOKING_INCLUDE,
      }),
    );

    return updated;
  }

  /**
   * Lista paginada de reservas con filtros
   */
  async findAll(query: BookingQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      customer_id,
      product_id,
      channel,
      date_from,
      date_to,
      sort_by,
      sort_order,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.bookingsWhereInput = {
      ...(search && {
        OR: [
          { booking_number: { contains: search, mode: 'insensitive' as any } },
          { notes: { contains: search, mode: 'insensitive' as any } },
        ],
      }),
      ...(status && { status }),
      ...(customer_id && { customer_id }),
      ...(product_id && { product_id }),
      ...(channel && { channel }),
      ...((date_from || date_to) && {
        date: {
          ...(date_from && { gte: new Date(date_from) }),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
    };

    const orderBy: any = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.date = 'asc';
    }

    const [data, total] = await Promise.all([
      this.prisma.bookings.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: this.BOOKING_INCLUDE,
      }),
      this.prisma.bookings.count({ where }),
    ]);

    return {
      data: this.mapBookings(data),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Obtiene una reserva por ID
   */
  async findOne(id: number) {
    const booking = await this.prisma.bookings.findFirst({
      where: { id },
      include: this.BOOKING_INCLUDE,
    });

    if (!booking) {
      throw new NotFoundException('Reserva no encontrada');
    }

    return this.mapBooking(booking);
  }

  /**
   * Confirma una reserva (pending -> confirmed)
   */
  async confirm(id: number) {
    const booking = await this.transition(id, 'confirmed');
    this.eventEmitter.emit('booking.confirmed', {
      store_id: booking.store_id,
      booking_id: booking.id,
      booking_number: booking.booking_number,
      customer_name:
        `${booking.customer?.first_name ?? ''} ${booking.customer?.last_name ?? ''}`.trim() ||
        'Cliente',
      service_name: booking.product?.name ?? 'Servicio',
      date:
        booking.date instanceof Date
          ? booking.date.toISOString().split('T')[0]
          : String(booking.date).split('T')[0],
      start_time: booking.start_time,
    });
    return booking;
  }

  /**
   * Inicia una reserva (confirmed -> in_progress)
   */
  async start(id: number) {
    const booking = await this.transition(id, 'in_progress');
    this.eventEmitter.emit('booking.started', {
      store_id: booking.store_id,
      booking_id: booking.id,
      booking_number: booking.booking_number,
      customer_name:
        `${booking.customer?.first_name ?? ''} ${booking.customer?.last_name ?? ''}`.trim() ||
        'Cliente',
      service_name: booking.product?.name ?? 'Servicio',
      date:
        booking.date instanceof Date
          ? booking.date.toISOString().split('T')[0]
          : String(booking.date).split('T')[0],
      start_time: booking.start_time,
    });
    return booking;
  }

  /**
   * Cancela una reserva (pending|confirmed -> cancelled)
   */
  async cancel(id: number) {
    const booking = await this.transition(id, 'cancelled');
    this.eventEmitter.emit('booking.cancelled', {
      store_id: booking.store_id,
      booking_id: booking.id,
      booking_number: booking.booking_number,
      customer_name:
        `${booking.customer?.first_name ?? ''} ${booking.customer?.last_name ?? ''}`.trim() ||
        'Cliente',
      service_name: booking.product?.name ?? 'Servicio',
      date:
        booking.date instanceof Date
          ? booking.date.toISOString().split('T')[0]
          : String(booking.date).split('T')[0],
      start_time: booking.start_time,
    });
    return booking;
  }

  /**
   * Completa una reserva (confirmed|in_progress -> completed)
   */
  async complete(id: number) {
    const booking = await this.transition(id, 'completed');
    this.eventEmitter.emit('booking.completed', {
      store_id: booking.store_id,
      booking_id: booking.id,
      booking_number: booking.booking_number,
      customer_name:
        `${booking.customer?.first_name ?? ''} ${booking.customer?.last_name ?? ''}`.trim() ||
        'Cliente',
      service_name: booking.product?.name ?? 'Servicio',
      date:
        booking.date instanceof Date
          ? booking.date.toISOString().split('T')[0]
          : String(booking.date).split('T')[0],
      start_time: booking.start_time,
    });
    return booking;
  }

  /**
   * Marca una reserva como no-show (confirmed -> no_show)
   */
  async noShow(id: number) {
    const booking = await this.transition(id, 'no_show');
    this.eventEmitter.emit('booking.no_show', {
      store_id: booking.store_id,
      booking_id: booking.id,
      booking_number: booking.booking_number,
      customer_name:
        `${booking.customer?.first_name ?? ''} ${booking.customer?.last_name ?? ''}`.trim() ||
        'Cliente',
      service_name: booking.product?.name ?? 'Servicio',
      date:
        booking.date instanceof Date
          ? booking.date.toISOString().split('T')[0]
          : String(booking.date).split('T')[0],
      start_time: booking.start_time,
    });
    return booking;
  }

  /**
   * Reprograma una reserva a un nuevo horario
   */
  async reschedule(id: number, dto: RescheduleBookingDto) {
    const booking = await this.findOne(id);

    // Solo se pueden reprogramar reservas pendientes o confirmadas
    if (
      booking.status !== booking_status_enum.pending &&
      booking.status !== booking_status_enum.confirmed
    ) {
      throw new BadRequestException(
        `No se puede reprogramar una reserva en estado "${booking.status}"`,
      );
    }

    // Validar disponibilidad del nuevo slot (excluyendo la reserva actual)
    const isAvailable = await this.availabilityService.isSlotAvailable(
      booking.product_id,
      dto.date,
      dto.start_time,
      dto.end_time,
      booking.provider_id ?? undefined,
      booking.id,
    );

    if (!isAvailable) {
      throw new ConflictException(
        'El nuevo horario solicitado no esta disponible',
      );
    }

    // Validar que no haya superposicion para el cliente
    await this.availabilityService.validateNoOverlapForCustomer(
      booking.customer_id,
      dto.date,
      dto.start_time,
      dto.end_time,
      booking.id,
    );

    const updated = this.mapBooking(
      await this.prisma.bookings.update({
        where: { id },
        data: {
          date: new Date(dto.date),
          start_time: dto.start_time,
          end_time: dto.end_time,
          updated_at: new Date(),
        },
        include: this.BOOKING_INCLUDE,
      }),
    );

    this.eventEmitter.emit('booking.rescheduled', {
      store_id: updated.store_id,
      booking_id: updated.id,
      booking_number: updated.booking_number,
      new_date: dto.date,
      new_start_time: dto.start_time,
      new_end_time: dto.end_time,
    });

    return updated;
  }

  /**
   * Obtiene estadisticas de reservas
   */
  async getStats() {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const thirtyDaysAgo = new Date(todayStart);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      today_count,
      pending_count,
      confirmed_count,
      total_last_30,
      cancelled_last_30,
      no_show_last_30,
    ] = await Promise.all([
      this.prisma.bookings.count({
        where: { date: { gte: todayStart, lt: todayEnd } },
      }),
      this.prisma.bookings.count({
        where: { status: booking_status_enum.pending },
      }),
      this.prisma.bookings.count({
        where: { status: booking_status_enum.confirmed },
      }),
      this.prisma.bookings.count({
        where: { created_at: { gte: thirtyDaysAgo } },
      }),
      this.prisma.bookings.count({
        where: {
          status: booking_status_enum.cancelled,
          created_at: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.bookings.count({
        where: {
          status: booking_status_enum.no_show,
          created_at: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    const cancellation_rate =
      total_last_30 > 0
        ? Math.round((cancelled_last_30 / total_last_30) * 10000) / 100
        : 0;

    const no_show_rate =
      total_last_30 > 0
        ? Math.round((no_show_last_30 / total_last_30) * 10000) / 100
        : 0;

    return {
      today_count,
      pending_count,
      confirmed_count,
      cancellation_rate,
      no_show_rate,
    };
  }

  /**
   * Obtiene las reservas de hoy ordenadas por hora de inicio
   */
  async getToday() {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const bookings = await this.prisma.bookings.findMany({
      where: {
        date: { gte: todayStart, lt: todayEnd },
      },
      orderBy: { start_time: 'asc' },
      include: this.BOOKING_INCLUDE,
    });
    return this.mapBookings(bookings);
  }

  /**
   * Obtiene reservas agrupadas por fecha para vista de calendario
   */
  async getCalendar(query: CalendarQueryDto) {
    const where: any = {
      date: {
        gte: new Date(query.date_from),
        lte: new Date(query.date_to),
      },
    };

    if (query.product_id) where.product_id = query.product_id;
    if (query.status) where.status = query.status;

    const bookings = this.mapBookings(
      await this.prisma.bookings.findMany({
        where,
        include: this.BOOKING_INCLUDE,
        orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
      }),
    );

    // Group by date string
    const grouped: Record<string, any[]> = {};
    for (const booking of bookings) {
      const dateKey =
        booking.date instanceof Date
          ? booking.date.toISOString().split('T')[0]
          : String(booking.date).split('T')[0];
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(booking);
    }

    return grouped;
  }

  // --- Helpers privados ---

  /**
   * Ejecuta una transicion de estado validando la maquina de estados
   */
  private async transition(id: number, targetStatus: string) {
    const booking = await this.findOne(id);
    const allowed = this.VALID_TRANSITIONS[booking.status] || [];

    if (!allowed.includes(targetStatus)) {
      throw new BadRequestException(
        `No se puede cambiar de "${booking.status}" a "${targetStatus}"`,
      );
    }

    return this.mapBooking(
      await this.prisma.bookings.update({
        where: { id },
        data: {
          status: targetStatus as booking_status_enum,
          updated_at: new Date(),
        },
        include: this.BOOKING_INCLUDE,
      }),
    );
  }

  /**
   * Genera un numero de reserva unico: BKG-YYYYMMDD-XXXX
   */
  private async generateBookingNumber(
    store_id: number,
    date: string,
  ): Promise<string> {
    const targetDate = new Date(date);
    const year = targetDate.getUTCFullYear().toString();
    const month = (targetDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = targetDate.getUTCDate().toString().padStart(2, '0');
    const prefix = `BKG-${year}${month}${day}-`;

    const lastBooking = await this.prisma.bookings.findFirst({
      where: {
        store_id,
        booking_number: { startsWith: prefix },
      },
      orderBy: { booking_number: 'desc' },
    });

    let sequence = 1;
    if (lastBooking) {
      const lastSequence = parseInt(lastBooking.booking_number.slice(-4));
      sequence = lastSequence + 1;
    }

    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }
}
