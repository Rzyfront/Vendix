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
import { S3Service } from '@common/services/s3.service';
import { PriceResolverService } from '../products/services/price-resolver.service';
import { TablesService } from '../tables/tables.service';
import { TableSessionsService } from '../tables/table-sessions.service';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly availabilityService: AvailabilityService,
    private readonly ordersService: OrdersService,
    private readonly s3Service: S3Service,
    private readonly eventEmitter: EventEmitter2,
    private readonly priceResolverService: PriceResolverService,
    private readonly tablesService: TablesService,
    private readonly tableSessionsService: TableSessionsService,
  ) {}

  // Estado maquina de transiciones validas
  // Includes the appointment redesign states (arriving, attending) that the
  // smart queue and proximity notifications consume. Transitions added in
  // phase 1 of the redesign:
  //   confirmed → arriving   (client or staff check-in)
  //   arriving  → attending  (staff calls the customer)
  //   attending → in_progress (staff starts the service)
  // arriving/attending/in_progress all share the same exit paths as the
  // previous confirmed → {completed, cancelled, no_show}.
  private readonly VALID_TRANSITIONS: Record<string, string[]> = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['arriving', 'in_progress', 'completed', 'cancelled', 'no_show'],
    arriving: ['attending', 'in_progress', 'cancelled', 'no_show'],
    attending: ['in_progress', 'cancelled', 'no_show'],
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
        is_consultation: true,
        consultation_template_id: true,
        preconsultation_template_id: true,
        product_images: {
          where: { is_main: true },
          select: { image_url: true },
          take: 1,
        },
      },
    },
    product_variants: {
      select: {
        id: true,
        name: true,
        sku: true,
        attributes: true,
        price_override: true,
        is_on_sale: true,
        sale_price: true,
        service_duration_minutes: true,
        buffer_minutes: true,
        preparation_time_minutes: true,
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
   * y firma la URL de S3 para que sea accesible desde el frontend
   */
  private async mapBooking(booking: any) {
    if (booking?.product?.product_images) {
      const mainImage = booking.product.product_images[0];
      booking.product.image_url = mainImage?.image_url || null;
      delete booking.product.product_images;
    }
    // Sign the product image URL if it's an S3 key
    if (booking?.product?.image_url) {
      booking.product.image_url = await this.s3Service.signUrl(
        booking.product.image_url,
      );
    }
    // Sign the provider avatar URL if it's an S3 key
    if (booking?.provider?.avatar_url) {
      booking.provider.avatar_url = await this.s3Service.signUrl(
        booking.provider.avatar_url,
      );
    }
    return booking;
  }

  private async mapBookings(bookings: any[]) {
    return Promise.all(bookings.map((b) => this.mapBooking(b)));
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
        base_price: true,
        is_on_sale: true,
        sale_price: true,
        track_inventory: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto/servicio no encontrado');
    }

    // Validate product_variant_id if provided
    let selectedVariant: {
      id: number;
      price_override: Prisma.Decimal | null;
      is_on_sale: boolean;
      sale_price: Prisma.Decimal | null;
      track_inventory_override: boolean | null;
    } | null = null;
    if (dto.product_variant_id) {
      selectedVariant = await this.prisma.product_variants.findFirst({
        where: { id: dto.product_variant_id, product_id: dto.product_id },
        select: {
          id: true,
          price_override: true,
          is_on_sale: true,
          sale_price: true,
          track_inventory_override: true,
        },
      });
      if (!selectedVariant) {
        throw new BadRequestException('Variant does not belong to product');
      }
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

    // 6. Atomicidad (QUI-649) + fix de regresión post-PR-576:
    //
    //    Antes: la orden se creaba con `OrdersService.create()` DENTRO de la
    //    transacción serializable. Ese método escribe con `this.prisma`
    //    (autocommit, otra conexión), así que la fila commiteada por fuera
    //    no era visible al chequeo de FK de `tx.bookings.update` y la
    //    reserva respondía HTTP 500 cada vez.
    //
    //    Ahora: si la reserva debe auto-crear su orden, la creamos ANTES
    //    de abrir la transacción (autocommit, fila persistente y visible
    //    desde el inicio). El chequeo de FK dentro del tx ve la fila
    //    porque ya está commiteada. Si el tx falla, compensamos cancelando
    //    la orden creada con `OrdersService.cancel`, que libera su stock
    //    reservado y mantiene el invariante "reserva y orden nacen juntas
    //    o no nacen".
    //
    //    Cuando el cliente ya trae `dto.order_id` (lo creó el POS o el
    //    storefront antes de la reserva), no tocamos orders aquí: la
    //    reserva solo apunta a la fila existente.
    let preCreatedOrder: { id: number } | null = null;
    if (!dto.order_id && !dto.skip_order_creation) {
      const priceResult = this.priceResolverService.resolvePrice({
        product: {
          base_price: Number(product.base_price),
          is_on_sale: product.is_on_sale,
          sale_price:
            product.sale_price != null ? Number(product.sale_price) : null,
          track_inventory: product.track_inventory,
        },
        variant: selectedVariant
          ? {
              price_override:
                selectedVariant.price_override != null
                  ? Number(selectedVariant.price_override)
                  : null,
              is_on_sale: selectedVariant.is_on_sale,
              sale_price:
                selectedVariant.sale_price != null
                  ? Number(selectedVariant.sale_price)
                  : null,
              track_inventory_override:
                selectedVariant.track_inventory_override,
            }
          : undefined,
      });
      const price = priceResult.unitPrice;
      const createdOrder = await this.ordersService.create(
        {
          customer_id: dto.customer_id,
          items: [
            {
              product_id: dto.product_id,
              product_variant_id: dto.product_variant_id,
              product_name: product.name || 'Servicio',
              quantity: 1,
              unit_price: price,
              total_price: price,
            },
          ],
          subtotal: price,
          total_amount: price,
          internal_notes: `Reserva ${booking_number} (orden creada antes de la reserva)`,
          channel: dto.channel || 'pos',
          skip_schedule_validation: true,
        } as any,
        context?.user_id,
      );
      preCreatedOrder = { id: createdOrder.id };
    }

    let booking: Awaited<ReturnType<typeof this.mapBooking>> | null = null;
    try {
      booking = await this.prisma.$transaction(
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

          const orderIdForBooking = dto.order_id ?? preCreatedOrder?.id ?? null;

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
              order_id: orderIdForBooking,
              table_id: dto.table_id ?? null,
              provider_id: resolvedProviderId,
              product_variant_id: dto.product_variant_id ?? null,
              created_by_user_id: context?.user_id,
              // Phase 1 of service-location feature: 'home' = technician
              // goes to the customer; 'shop' = customer goes to the local.
              // service_address_id is only meaningful when home.
              service_location_type: dto.service_location_type || 'shop',
              service_address_id:
                dto.service_location_type === 'home'
                  ? (dto.service_address_id ?? null)
                  : null,
              updated_at: new Date(),
            },
            include: this.BOOKING_INCLUDE,
          });

          return await this.mapBooking(created);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      // Compensar la orden pre-creada para preservar el invariante de
      // QUI-649: reserva y orden nacen juntas o no nacen. Si la
      // cancelación también falla (DB caída, lock), la orden queda en
      // 'created' huérfana — aceptable, mejor que el bug de "reserva
      // caída y orden persistida" que el plan repara.
      if (preCreatedOrder) {
        try {
          // OrdersService no expone `cancel()`. La cancelación es una
          // transición de estado que pasa por `update()` — el seam
          // `forceOrderState` interno libera las reservas de stock,
          // emite `order.cancelled` y deja la transición auditada.
          await this.ordersService.update(preCreatedOrder.id, {
            state: 'cancelled',
            internal_notes: `Compensación por fallo de reserva (booking_id=${preCreatedOrder.id}).`,
          } as any);
        } catch (cancelErr) {
          this.logger.error(
            `Failed to compensate order ${preCreatedOrder.id} after booking failed: ${cancelErr.message}`,
          );
        }
      }
      throw err;
    }

    // 7. Marcar la mesa como reservada si se asignó una tabla
    if (dto.table_id) {
      try {
        await this.prisma.tables.updateMany({
          where: { id: dto.table_id, store_id, status: 'available' },
          data: { status: 'reserved', updated_at: new Date() },
        });
      } catch {
        // No-op: la mesa puede no existir o estar en otro estado.
      }
    }

    // 7. Emitir evento
    this.eventEmitter.emit('booking.created', {
      store_id,
      booking_id: booking.id,
      booking_number: booking.booking_number,
      // CP-POS-SVC-PERF-001 / HU-B + HU-C — anonymous sales carry
      // bookings without a linked customer; the event listener
      // doesn't need a name string when the booking is unattached.
      customer_name: booking.customer
        ? `${booking.customer.first_name} ${booking.customer.last_name}`
        : 'Consumidor Final',
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
    product_variant_id?: number;
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

    if (dto.product_variant_id) {
      const variantOk = await this.prisma.product_variants.findFirst({
        where: { id: dto.product_variant_id, product_id: dto.product_id },
        select: { id: true },
      });
      if (!variantOk) {
        throw new BadRequestException('Variant does not belong to product');
      }
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
        product_variant_id: dto.product_variant_id ?? null,
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

    return await this.mapBooking(booking);
  }

  async confirmHold(id: number) {
    const booking = await this.findOne(id);

    if (booking.expires_at && new Date(booking.expires_at) < new Date()) {
      await this.prisma.bookings.delete({ where: { id } });
      throw new BadRequestException(
        'La reserva temporal ha expirado. Por favor selecciona un horario nuevamente.',
      );
    }

    const updated = await this.mapBooking(
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
   * Asigna (o reasigna) una mesa a una reserva. Marca la mesa como
   * 'reserved' si estaba 'available'. NO toca el estado de la reserva.
   */
  async assignTable(bookingId: number, tableId: number) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new BadRequestException('No se encontro contexto de tienda');
    }
    const booking = await this.findOne(bookingId);
    if (booking.store_id !== store_id) {
      throw new NotFoundException('Reserva no encontrada');
    }
    const table = await this.tablesService.getById(tableId);
    if (table.store_id !== store_id) {
      throw new NotFoundException('Mesa no encontrada');
    }
    const updated = await this.mapBooking(
      await this.prisma.bookings.update({
        where: { id: bookingId },
        data: { table_id: tableId, updated_at: new Date() },
        include: this.BOOKING_INCLUDE,
      }),
    );
    if (table.status === 'available') {
      await this.prisma.tables.update({
        where: { id: tableId },
        data: { status: 'reserved', updated_at: new Date() },
      });
    }
    return updated;
  }

  /**
   * Sienta una reserva: pending → confirmed → in_progress y abre
   * una table_session con el customer de la reserva. La mesa pasa
   * a 'occupied'.
   */
  async seatBooking(bookingId: number, tableId?: number) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new BadRequestException('No se encontro contexto de tienda');
    }
    const booking = await this.findOne(bookingId);
    if (booking.store_id !== store_id) {
      throw new NotFoundException('Reserva no encontrada');
    }
    const targetTableId = tableId ?? booking.table_id;
    if (!targetTableId) {
      throw new BadRequestException(
        'La reserva no tiene mesa asignada. Asigna una antes de sentar.',
      );
    }
    if (booking.status === 'pending') {
      await this.transition(bookingId, 'confirmed');
    }
    if (booking.status !== 'in_progress') {
      await this.start(bookingId);
    }
    const session = await this.tableSessionsService.openSession({
      table_id: targetTableId,
      customer_id: booking.customer_id,
    });
    return session;
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

    let orderBy: any;
    if (sort_by) {
      orderBy = { [sort_by]: sort_order === 'desc' ? 'desc' : 'asc' };
    } else {
      orderBy = [{ date: 'asc' }, { start_time: 'asc' }];
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
      data: await this.mapBookings(data),
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

    return await this.mapBooking(booking);
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
      product_id: booking.product_id,
      customer_id: booking.customer_id,
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
      provider_id: booking.provider_id,
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
      product_id: booking.product_id,
      customer_id: booking.customer_id,
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
   * Versión "silenciosa" de `noShow` para uso de background jobs.
   * Misma transición de estado (`pending|confirmed → no_show`) pero SIN
   * emitir `booking.no_show` — el cron AutoNoShowJob no debería mandar
   * notificación al operador por cada booking auto-archivada (el flood
   * de notificaciones sería peor que el problema original de stats).
   *
   * Si en el futuro se quiere notificar al operador cuando el cron
   * archiva N bookings, exponer un evento separado tipo
   * `booking.auto_archived` con `count` + `ids[]` y dejar que el
   * listener agrupe las notificaciones.
   */
  async archiveToNoShow(id: number): Promise<void> {
    await this.transition(id, 'no_show');
  }

  /**
   * Reprograma una reserva a un nuevo horario.
   *
   * Appointment redesign phase 2 — el método respeta
   * `store_settings.settings.reservations.allow_direct_reschedule`:
   *
   *   * `true`  → comportamiento histórico: la reserva se mueve al
   *     instante y se emite `booking.rescheduled`. Es la ruta
   *     `reschedule_direct_path()`.
   *   * `false` → la reserva NO se mueve; se crea una fila
   *     `booking_reschedule_requests` con status `pending` y se emite
   *     `booking.reschedule_requested`. El admin debe aprobar o
   *     rechazar desde la cola. Es la ruta `requestReschedule()`.
   *
   * Para preservar paridad exacta con el comportamiento previo
   * (reschedule siempre directo), el default del setting es `true`.
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

    // Gate de política: si la tienda deshabilitó el reagendamiento directo,
    // enrutar a la ruta de aprobación y abortar acá.
    const allowDirect = await this.resolveAllowDirectReschedule(
      booking.store_id,
    );
    if (!allowDirect) {
      // Importante: NO mutar `bookings` en este branch. Sólo creamos la
      // solicitud y emitimos el evento. El booking-detail-modal del admin
      // mostrará el banner "Solicitud de reagenda pendiente".
      const newRequest = await this.requestReschedule(booking, dto, {
        requestedByCustomerId: booking.customer_id,
      });

      return this.findOne(id); // re-leer para devolver el booking SIN cambios
      // `newRequest` se ignora acá a propósito — el caller no necesita el
      // id de la solicitud; el ecommerce frontend va a recibir la 202 +
      // un header `X-Reschedule-Request-Id` que el controller inyecta.
      // (Ver `ecommerce-reservations.controller.reschedule`.)
    }

    // --- Reschedule directo (ruta legacy preservada) --------------------
    return this.rescheduleDirectPath(id, booking, dto);
  }

  /**
   * Lógica interna del reagendamiento directo (1 click). Extraída de
   * `reschedule()` para que `requestReschedule` también pueda reutilizar
   * la validación de slot/overlap sin duplicarla.
   */
  private async rescheduleDirectPath(
    id: number,
    booking: Awaited<ReturnType<ReservationsService['findOne']>>,
    dto: RescheduleBookingDto,
  ) {
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

    const updated = await this.mapBooking(
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

    // Side-effect opcional: si el cliente lo pide (`reopen_order=true` desde
    // ecommerce) y el pedido asociado está cancelado, lo reactivamos a
    // `processing` (el cliente ya pagó y tiene booking, es el estado
    // correcto post-pago según VALID_TRANSITIONS del OrderFlowService).
    // Sin esto, el reschedule mueve la cita pero el pedido se queda
    // diciendo "Cancelado" — UX rota. El default `false` preserva el
    // comportamiento histórico del admin flow (no toca orders).
    if (dto.reopen_order === true && updated.order_id) {
      const order = await this.prisma.orders.findUnique({
        where: { id: updated.order_id },
        select: { id: true, state: true, store_id: true, order_number: true },
      });
      if (order && order.state === 'cancelled') {
        await this.prisma.orders.update({
          where: { id: order.id },
          data: { state: 'processing', updated_at: new Date() },
        });
        this.eventEmitter.emit('order.status_changed', {
          store_id: order.store_id,
          order_id: order.id,
          order_number: order.order_number,
          old_state: 'cancelled',
          new_state: 'processing',
        });
      }
    }

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
   * Crea una solicitud de reagendamiento pendiente. NO muta `bookings`.
   * Valida la disponibilidad del slot solicitado antes de crear la fila
   * (un slot ya ocupado no debería siquiera generar una solicitud).
   *
   * Devuelve la fila creada para que el controller adjunte el id en un
   * header (`X-Reschedule-Request-Id`) y el frontend del ecommerce pueda
   * mostrar "Pendiente de aprobación" en la tarjeta del booking.
   */
  async requestReschedule(
    booking: Awaited<ReturnType<ReservationsService['findOne']>>,
    dto: { date: string; start_time: string; end_time: string; reason?: string },
    ctx: {
      requestedByUserId?: number;
      requestedByCustomerId?: number;
    },
  ) {
    // Si ya existe una solicitud PENDING para esta reserva, no dejamos
    // crear otra — el cliente debe cancelar la anterior primero.
    const existing = await this.prisma.booking_reschedule_requests.findFirst({
      where: { booking_id: booking.id, status: 'pending' },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe una solicitud de reagendamiento pendiente (#${existing.id}). Cancélala antes de pedir otra.`,
      );
    }

    // Misma validación de slot que el reschedule directo, para que la
    // solicitud NO se cree sobre un slot ya ocupado. Si el admin
    // aprueba después y algo cambió, la approval vuelve a chequear.
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
        'El horario solicitado no está disponible',
      );
    }
    await this.availabilityService.validateNoOverlapForCustomer(
      booking.customer_id,
      dto.date,
      dto.start_time,
      dto.end_time,
      booking.id,
    );

    const created = await this.prisma.booking_reschedule_requests.create({
      data: {
        store_id: booking.store_id,
        booking_id: booking.id,
        requested_date: new Date(dto.date),
        requested_start_time: dto.start_time,
        requested_end_time: dto.end_time,
        requested_by_user_id: ctx.requestedByUserId ?? null,
        requested_by_customer_id: ctx.requestedByCustomerId ?? null,
        reason: dto.reason ?? null,
        status: 'pending',
      },
    });

    this.eventEmitter.emit('booking.reschedule_requested', {
      store_id: booking.store_id,
      booking_id: booking.id,
      booking_number: booking.booking_number,
      request_id: created.id,
      requested_date: dto.date,
      requested_start_time: dto.start_time,
      requested_end_time: dto.end_time,
      requested_by_customer_id: ctx.requestedByCustomerId ?? null,
      customer_name: `${booking.customer?.first_name ?? ''} ${booking.customer?.last_name ?? ''}`.trim(),
      service_name: booking.product?.name ?? '',
      reason: dto.reason ?? null,
    });

    return created;
  }

  /**
   * Aprueba una solicitud de reagendamiento pendiente. Aplica el cambio
   * sobre `bookings` (mueve la reserva al slot solicitado) y marca la
   * solicitud como `approved`.
   */
  async approveRescheduleRequest(
    requestId: number,
    ctx: { decidedByUserId: number; decisionReason?: string },
  ) {
    const request = await this.prisma.booking_reschedule_requests.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Solicitud ${requestId} no encontrada`);
    }
    if (request.status !== 'pending') {
      throw new BadRequestException(
        `La solicitud ya está en estado "${request.status}"`,
      );
    }

    const booking = await this.findOne(request.booking_id);

    // Re-validar slot al momento de aprobar (entre la solicitud y la
    // aprobación algo pudo haber sido ocupado por otro canal).
    const isAvailable = await this.availabilityService.isSlotAvailable(
      booking.product_id,
      this.formatDateOnly(request.requested_date),
      request.requested_start_time,
      request.requested_end_time,
      booking.provider_id ?? undefined,
      booking.id,
    );
    if (!isAvailable) {
      throw new ConflictException(
        'El horario solicitado ya no está disponible; rechaza la solicitud y pide al cliente elegir otro slot',
      );
    }

    const updated = await this.mapBooking(
      await this.prisma.bookings.update({
        where: { id: booking.id },
        data: {
          date: request.requested_date,
          start_time: request.requested_start_time,
          end_time: request.requested_end_time,
          updated_at: new Date(),
        },
        include: this.BOOKING_INCLUDE,
      }),
    );

    await this.prisma.booking_reschedule_requests.update({
      where: { id: requestId },
      data: {
        status: 'approved',
        decided_by_user_id: ctx.decidedByUserId,
        decided_at: new Date(),
        decision_reason: ctx.decisionReason ?? null,
      },
    });

    this.eventEmitter.emit('booking.rescheduled', {
      store_id: updated.store_id,
      booking_id: updated.id,
      booking_number: updated.booking_number,
      new_date: this.formatDateOnly(request.requested_date),
      new_start_time: request.requested_start_time,
      new_end_time: request.requested_end_time,
    });

    this.eventEmitter.emit('booking.reschedule_approved', {
      store_id: updated.store_id,
      booking_id: updated.id,
      booking_number: updated.booking_number,
      request_id: requestId,
      new_date: this.formatDateOnly(request.requested_date),
      new_start_time: request.requested_start_time,
      new_end_time: request.requested_end_time,
      customer_id: booking.customer_id,
      decision_reason: ctx.decisionReason ?? null,
      // Appointment redesign phase 2 — propagated so the notifications
      // listener can send the email "From" this specific admin/staff
      // (instead of the generic store owner), so the customer sees the
      // real human who decided.
      decided_by_user_id: ctx.decidedByUserId,
    });

    return updated;
  }

  /**
   * Rechaza una solicitud de reagendamiento pendiente. NO muta `bookings`.
   */
  async rejectRescheduleRequest(
    requestId: number,
    ctx: { decidedByUserId: number; decisionReason: string },
  ) {
    if (!ctx.decisionReason || ctx.decisionReason.trim().length === 0) {
      throw new BadRequestException(
        'Debes proporcionar una razón para rechazar la solicitud',
      );
    }

    const request = await this.prisma.booking_reschedule_requests.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Solicitud ${requestId} no encontrada`);
    }
    if (request.status !== 'pending') {
      throw new BadRequestException(
        `La solicitud ya está en estado "${request.status}"`,
      );
    }

    const booking = await this.findOne(request.booking_id);

    await this.prisma.booking_reschedule_requests.update({
      where: { id: requestId },
      data: {
        status: 'rejected',
        decided_by_user_id: ctx.decidedByUserId,
        decided_at: new Date(),
        decision_reason: ctx.decisionReason,
      },
    });

    this.eventEmitter.emit('booking.reschedule_rejected', {
      store_id: request.store_id,
      booking_id: booking.id,
      booking_number: booking.booking_number,
      request_id: requestId,
      customer_id: booking.customer_id,
      decision_reason: ctx.decisionReason,
      // Appointment redesign phase 2 — see comment on approved event.
      decided_by_user_id: ctx.decidedByUserId,
    });

    return this.findOne(booking.id);
  }

  /**
   * Cancela una solicitud pendiente (cliente la retira, o admin la retira).
   */
  async cancelRescheduleRequest(
    requestId: number,
    ctx: { cancelledByUserId?: number },
  ) {
    const request = await this.prisma.booking_reschedule_requests.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException(`Solicitud ${requestId} no encontrada`);
    }
    if (request.status !== 'pending') {
      throw new BadRequestException(
        `La solicitud ya está en estado "${request.status}"`,
      );
    }

    await this.prisma.booking_reschedule_requests.update({
      where: { id: requestId },
      data: {
        status: 'cancelled',
        decided_at: new Date(),
        // Reusamos decided_by_user_id para registrar QUIÉN canceló (admin
        // o el customer via ecommerce). El customer cancel desde el
        // ecommerce path no setea decided_by_user_id — el audit queda
        // en el log de la propia request.
        decided_by_user_id: ctx.cancelledByUserId ?? null,
      },
    });

    const booking = await this.findOne(request.booking_id);
    this.eventEmitter.emit('booking.reschedule_cancelled', {
      store_id: request.store_id,
      booking_id: booking.id,
      booking_number: booking.booking_number,
      request_id: requestId,
      customer_id: booking.customer_id,
      cancelled_by_user_id: ctx.cancelledByUserId ?? null,
    });

    return this.findOne(booking.id);
  }

  /**
   * Resuelve el flag `settings.reservations.allow_direct_reschedule`
   * para la tienda dueña de la reserva. Default `true` (comportamiento
   * legacy: reagendar = 1 click).
   *
   * Patrón defensivo, mismo que `AvailabilityService.getStoreWorkingDays`:
   * la columna `settings` es JSON sin schema enforcement, así que
   * toleramos valores faltantes / mal-tipos / fila inexistente.
   */
  private async resolveAllowDirectReschedule(
    storeId: number,
  ): Promise<boolean> {
    const DEFAULT_ALLOW_DIRECT_RESCHEDULE = true;

    const settingsRow = await this.prisma.store_settings.findUnique({
      where: { store_id: storeId },
      select: { settings: true },
    });

    const raw = (settingsRow?.settings as any)?.reservations
      ?.allow_direct_reschedule;
    if (typeof raw === 'boolean') return raw;
    return DEFAULT_ALLOW_DIRECT_RESCHEDULE;
  }

  /** Helper local: convierte `Date | string` a `YYYY-MM-DD`. */
  private formatDateOnly(value: Date | string): string {
    if (typeof value === 'string') return value.split('T')[0];
    return value.toISOString().split('T')[0];
  }

  /**
   * Obtiene estadisticas de reservas
   *
   * Date comparisons use UTC midnight (not local midnight) because
   * the `bookings.date` column is `@db.Date` and is stored as UTC
   * midnight (e.g. 2026-07-02 00:00:00Z). Using `new Date(year, month,
   * day)` in a non-UTC tz (e.g. Colombia = UTC-5) yields a value 5h
   * ahead of the stored value, so the gte compare fails. Both this
   * method and `getToday` use `Date.UTC(...)` for consistency.
   */
  async getStats() {
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

    const thirtyDaysAgo = new Date(todayStart);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

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
   *
   * Uses UTC midnight for the date range. See getStats() comment
   * for the rationale (bookings.date is @db.Date stored as UTC
   * midnight; local midnight would miss the record in non-UTC
   * timezones).
   */
  async getToday() {
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

    const bookings = await this.prisma.bookings.findMany({
      where: {
        date: { gte: todayStart, lt: todayEnd },
      },
      orderBy: { start_time: 'asc' },
      include: this.BOOKING_INCLUDE,
    });
    return await this.mapBookings(bookings);
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

    const bookings = await this.mapBookings(
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

  async checkIn(id: number, source: 'customer' | 'staff') {
    const booking = await this.prisma.bookings.findUnique({
      where: { id },
      include: { customer: true, product: true, provider: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    // The appointment redesign accepts check-in from either 'confirmed' or
    // 'arriving' so staff can correct/refresh the timestamp without having to
    // walk the booking back to 'confirmed' first. Anything else (pending,
    // in_progress, completed, cancelled, no_show) is rejected.
    if (!['confirmed', 'arriving'].includes(booking.status as string)) {
      throw new BadRequestException(
        'Solo bookings confirmados o en arriving pueden hacer check-in',
      );
    }

    // Idempotency: if the customer already checked in, return the booking
    // untouched instead of throwing. Staff-driven check-ins (POS button) can
    // re-write the timestamp if they had to reset the queue position.
    if (booking.checked_in_at && source === 'customer') {
      this.logger.log(
        `checkIn idempotente (cliente duplicó): booking ${id} ya marcado a las ${booking.checked_in_at.toISOString()}`,
      );
      return booking;
    }

    const now = new Date();
    const targetStatus: booking_status_enum =
      booking.status === 'confirmed' ? 'arriving' : (booking.status as booking_status_enum);

    const updated = await this.prisma.bookings.update({
      where: { id },
      data: {
        checked_in_at: booking.checked_in_at ?? now,
        arrival_at: booking.arrival_at ?? now,
        status: targetStatus,
        updated_at: now,
      },
    });

    this.eventEmitter.emit('booking.checked_in', {
      store_id: updated.store_id,
      booking_id: updated.id,
      booking_number: booking.booking_number,
      customer_name: `${booking.customer?.first_name} ${booking.customer?.last_name}`,
      service_name: booking.product?.name,
      provider_id: booking.provider_id,
      source,
    });

    // Only emit 'booking.arrival_recorded' when this call actually set a new
    // arrival_at (i.e. the booking wasn't already in the queue). Idempotent
    // re-marks from staff or duplicate customer check-ins would otherwise
    // churn the queue recalculation for no benefit.
    if (!booking.arrival_at) {
      const isoDay = booking.date instanceof Date
        ? booking.date.toISOString().split('T')[0]
        : String(booking.date).split('T')[0];
      this.eventEmitter.emit('booking.arrival_recorded', {
        store_id: updated.store_id,
        booking_id: updated.id,
        date: isoDay,
      });
    }

    this.logger.log(`Check-in registrado para booking ${id} por ${source}`);
    return updated;
  }

  /**
   * Explicit transition `confirmed → arriving`. Used by staff from the queue
   * panel when they want to flag a customer as "on site" without going through
   * the customer-facing checkIn flow (e.g. the customer checked in at the
   * front desk instead of via the ecommerce link).
   */
  async markArriving(id: number) {
    return this.transition(id, 'arriving');
  }

  /**
   * Explicit transition `arriving → attending`. Used by staff from the queue
   * panel to flag "this customer is next, call them up to the chair".
   */
  async markAttending(id: number) {
    return this.transition(id, 'attending');
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

    return await this.mapBooking(
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
