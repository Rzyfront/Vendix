import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  booking_status_enum,
  booking_mode_enum,
  payments_state_enum,
  order_state_enum,
  Prisma,
} from '@prisma/client';
import {
  CreateBookingDto,
  RescheduleBookingDto,
  BookingQueryDto,
  CalendarQueryDto,
} from './dto';
import {
  AvailabilityService,
  FREE_BOOKING_CAPACITY,
  freeBookingOverlapWhere,
  slotHoldingBookingWhere,
} from './availability.service';
import { OrdersService } from '../orders/orders.service';
import { UpdateOrderDto } from '../orders/dto/update-order.dto';
import { S3Service } from '@common/services/s3.service';
import { PriceResolverService } from '../products/services/price-resolver.service';
import { TablesService } from '../tables/tables.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import { OrderHistoryService } from '../orders/order-history/order-history.service';
import { BusinessHoursService } from './business-hours/business-hours.service';
import {
  DEFAULT_STORE_TIMEZONE,
  dateOnlyString,
  localDateString,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import {
  CANCELABLE_ORDER_STATES,
  SETTLED_PAYMENT_STATES,
} from '../orders/order-flow/order-cancellation-policy.util';
import {
  isSerializationFailure,
  isUniqueViolationOn,
  nextSequenceNumber,
  retryBackoff,
} from '@common/utils/sequence-number.util';
import {
  BookingSlotInput,
  assertBookingSlotOpen,
  assertBookingSlotShape,
  isSlotStartInPast,
} from './booking-time.util';

/** Pricing columns of a product read to price a booking's order. */
const BOOKING_PRODUCT_PRICING_SELECT = {
  name: true,
  base_price: true,
  is_on_sale: true,
  sale_price: true,
  track_inventory: true,
} as const;

/** Pricing columns of a variant read to price a booking's order. */
const BOOKING_VARIANT_PRICING_SELECT = {
  id: true,
  price_override: true,
  is_on_sale: true,
  sale_price: true,
  track_inventory_override: true,
} as const;

type BookingPricedProduct = Prisma.productsGetPayload<{
  select: typeof BOOKING_PRODUCT_PRICING_SELECT;
}>;
type BookingPricedVariant = Prisma.product_variantsGetPayload<{
  select: typeof BOOKING_VARIANT_PRICING_SELECT;
}>;

/**
 * What happened to a booking's order when the booking was cancelled or
 * deleted (QUI-966 S7). Returned to staff/customer next to the booking.
 */
export interface BookingOrderRelease {
  order_cancelled: boolean;
  order_requires_refund: boolean;
  order_warning: string | null;
}

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
    // Plan order-truth-and-invoice-tz (Step 6) — writer único de order_events.
    private readonly orderHistory: OrderHistoryService,
    private readonly businessHoursService: BusinessHoursService,
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
  /**
   * QUI-966 (S3): FKs sent by the caller must belong to the current store.
   * `store_users`, `orders`, `tables` and `addresses` are store-scoped, so a
   * miss on the scoped delegate means "another tenant" (or nonexistent).
   * Without this a booking could point at a customer, order or table of a
   * different organization.
   */
  private async assertReferencesInStore(
    store_id: number,
    refs: {
      customer_id?: number | null;
      order_id?: number | null;
      table_id?: number | null;
      service_address_id?: number | null;
    },
  ) {
    if (refs.customer_id) {
      const membership = await this.prisma.store_users.findFirst({
        where: { store_id, user_id: refs.customer_id },
        select: { id: true },
      });
      if (!membership) {
        throw new VendixHttpException(
          ErrorCodes.ORD_EDIT_CUSTOMER_STORE_MISMATCH_001,
        );
      }
    }

    if (refs.order_id) {
      const order = await this.prisma.orders.findFirst({
        where: { id: refs.order_id },
        select: { id: true },
      });
      if (!order) throw new NotFoundException('Orden no encontrada');
    }

    if (refs.table_id) {
      const table = await this.prisma.tables.findFirst({
        where: { id: refs.table_id },
        select: { id: true },
      });
      if (!table) throw new NotFoundException('Mesa no encontrada');
    }

    if (refs.service_address_id) {
      const address = await this.prisma.addresses.findFirst({
        where: { id: refs.service_address_id, user_id: refs.customer_id ?? -1 },
        select: { id: true },
      });
      if (!address) {
        throw new NotFoundException('Dirección del servicio no encontrada');
      }
    }
  }

  /**
   * QUI-966 (S4): the one date/time gate every booking entry point runs.
   * Inverted/zero/midnight-crossing ranges and invalid dates are always
   * rejected. Past slots (store timezone) and slots outside the store
   * business hours are rejected unless staff explicitly forces them with
   * `skip_availability_check` (`allowOverride`); ecommerce never can.
   */
  private async assertBookableSlot(
    store_id: number,
    slot: BookingSlotInput,
    opts: { allowOverride?: boolean } = {},
  ): Promise<void> {
    assertBookingSlotShape(slot);
    if (opts.allowOverride === true) return;
    const [timezone, storeHours] = await Promise.all([
      resolveStoreTimezone(this.prisma, store_id),
      this.businessHoursService.loadStoreWindows(store_id),
    ]);
    assertBookingSlotOpen(slot, { timezone, storeHours });
  }

  /**
   * QUI-966 (S14): ecommerce checkout pre-check, run BEFORE the order exists
   * so an invalid or taken slot answers 400/409 and no order is created.
   * Same gate as `create` (never forced) plus the same slot availability
   * check `create` runs afterwards.
   */
  async assertCheckoutBookingBookable(
    store_id: number,
    booking: BookingSlotInput & { product_id: number; provider_id?: number },
  ): Promise<void> {
    await this.assertBookableSlot(store_id, booking);
    if (!booking.provider_id) {
      const product = await this.prisma.products.findFirst({
        where: { id: booking.product_id },
        select: { booking_mode: true },
      });
      if (!product) {
        throw new NotFoundException('Producto/servicio no encontrado');
      }
      // Same legacy fallback as `create`: a provider_required service with
      // zero active providers is booked without an availability check.
      if (
        product.booking_mode === booking_mode_enum.provider_required &&
        (await this.countActiveProviders(booking.product_id)) === 0
      ) {
        return;
      }
    }
    const isAvailable = await this.availabilityService.isSlotAvailable(
      booking.product_id,
      booking.date,
      booking.start_time,
      booking.end_time,
      booking.provider_id,
    );
    if (!isAvailable) {
      throw new ConflictException('El horario solicitado no esta disponible');
    }
  }

  private async countActiveProviders(product_id: number): Promise<number> {
    const serviceProviders = await this.prisma.provider_services.findMany({
      where: { product_id },
      include: { provider: { select: { id: true, is_active: true } } },
    });
    return serviceProviders.filter((sp) => sp.provider.is_active).length;
  }

  /**
   * Cancels an order whose booking could not be created, keeping the
   * QUI-649 invariant "booking and order are born together or not at all".
   * Goes through `OrdersService.update` (the `forceOrderState` seam releases
   * stock reservations, emits `order.cancelled` and audits the transition).
   * `note` travels as the cancel `reason` (audited with the transition), never
   * as `internal_notes`: that column holds the `_flow_metadata` JSON and a
   * blocked cancel must not leave a false note behind (QUI-966 T4b A1).
   * Best effort: a failure is logged and the order stays orphaned.
   */
  async compensateOrderForFailedBooking(
    order_id: number,
    note: string,
  ): Promise<boolean> {
    try {
      const dto: UpdateOrderDto = {
        state: order_state_enum.cancelled,
        reason: note.slice(0, 500),
      };
      await this.ordersService.update(order_id, dto);
      return true;
    } catch (cancelErr) {
      this.logger.error(
        `Failed to compensate order ${order_id} after booking failed: ${cancelErr.message}`,
      );
      return false;
    }
  }

  /**
   * Creates the order a booking is born with (QUI-649), priced on the server
   * with `PriceResolverService` — the caller never sends the price. Runs in
   * autocommit BEFORE the booking transaction (hotfix 576); the caller must
   * compensate it with `compensateOrderForFailedBooking` if the booking write
   * fails. Shared by `create` and `confirmHold` (QUI-966 S14).
   */
  private async preCreateBookingOrder(args: {
    product: BookingPricedProduct;
    variant: BookingPricedVariant | null;
    product_id: number;
    product_variant_id?: number | null;
    customer_id?: number | null;
    booking_number: string;
    channel: string;
    user_id?: number;
  }): Promise<{ id: number }> {
    const { product, variant } = args;
    const priceResult = this.priceResolverService.resolvePrice({
      product: {
        base_price: Number(product.base_price),
        is_on_sale: product.is_on_sale,
        sale_price:
          product.sale_price != null ? Number(product.sale_price) : null,
        track_inventory: product.track_inventory,
      },
      variant: variant
        ? {
            price_override:
              variant.price_override != null
                ? Number(variant.price_override)
                : null,
            is_on_sale: variant.is_on_sale,
            sale_price:
              variant.sale_price != null ? Number(variant.sale_price) : null,
            track_inventory_override: variant.track_inventory_override,
          }
        : undefined,
    });
    const price = priceResult.unitPrice;
    const createdOrder = await this.ordersService.create(
      {
        customer_id: args.customer_id,
        items: [
          {
            product_id: args.product_id,
            product_variant_id: args.product_variant_id ?? undefined,
            product_name: product.name || 'Servicio',
            quantity: 1,
            unit_price: price,
            total_price: price,
          },
        ],
        subtotal: price,
        total_amount: price,
        internal_notes: `Reserva ${args.booking_number} (orden creada antes de la reserva)`,
        channel: args.channel,
        skip_schedule_validation: true,
      } as any,
      args.user_id,
    );
    return { id: createdOrder.id };
  }

  /**
   * In-transaction re-check of a slot (QUI-966 S5), by overlap: a
   * `free_booking` service keeps its fixed capacity, a provider keeps one
   * booking at a time. `exclude_booking_id` skips the booking being written
   * (confirm-hold). Expired holds never count (T3 advisory A).
   */
  private async assertSlotStillFreeInTx(
    tx: Prisma.TransactionClient,
    slot: {
      product_id: number;
      date: string;
      start_time: string;
      end_time: string;
      provider_id?: number | null;
      isFreeBooking: boolean;
      exclude_booking_id?: number;
    },
  ): Promise<void> {
    let taken = false;
    if (slot.isFreeBooking) {
      const seatsTaken = await tx.bookings.count({
        where: freeBookingOverlapWhere(
          slot.product_id,
          slot.date,
          slot.start_time,
          slot.end_time,
          slot.exclude_booking_id,
        ),
      });
      taken = seatsTaken >= FREE_BOOKING_CAPACITY;
    } else if (slot.provider_id) {
      const providerBooked = await tx.bookings.count({
        where: {
          provider_id: slot.provider_id,
          date: new Date(slot.date),
          start_time: { lt: slot.end_time },
          end_time: { gt: slot.start_time },
          ...slotHoldingBookingWhere(),
          ...(slot.exclude_booking_id
            ? { id: { not: slot.exclude_booking_id } }
            : {}),
        },
      });
      taken = providerBooked > 0;
    }
    if (taken) {
      throw new ConflictException(
        'El horario ya no esta disponible (reservado por otro usuario)',
      );
    }
  }

  /**
   * QUI-966 S7 (decision L2): when a booking is cancelled or deleted, its
   * order is cancelled through the orders flow (`compensateOrderForFailedBooking`
   * → `OrdersService.update`, which releases stock and emits
   * `order.cancelled`) ONLY when it is safe:
   *  - no settled payment (`SETTLED_PAYMENT_STATES`) and no fiado abono
   *    (accounts receivable of the order with `paid_amount > 0` or
   *    `ar_payments`): a paid order is left untouched and staff is told to
   *    handle the refund;
   *  - no payment in flight (`pending`/`authorized`, e.g. Wompi/PSE): the
   *    order is left untouched and staff is told a payment is in process;
   *  - the order belongs to this booking alone: no line of another product
   *    and no other live booking on the same order (checkout orders can mix
   *    services, products and several bookings) — otherwise staff is warned;
   *  - the order is still in a cancelable state.
   * Never throws: the booking change already happened.
   */
  private async releaseBookingOrder(booking: {
    id: number;
    order_id?: number | null;
    product_id: number;
    booking_number: string;
  }): Promise<BookingOrderRelease> {
    const outcome: BookingOrderRelease = {
      order_cancelled: false,
      order_requires_refund: false,
      order_warning: null,
    };
    if (!booking.order_id) return outcome;
    const warn = (order_warning: string): BookingOrderRelease => ({
      ...outcome,
      order_warning,
    });

    try {
      const order = await this.prisma.orders.findFirst({
        where: { id: booking.order_id },
        select: {
          id: true,
          state: true,
          order_number: true,
          order_items: { select: { product_id: true } },
        },
      });
      if (!order || order.state === 'cancelled') return outcome;
      const label = order.order_number || `#${order.id}`;

      const settledPayment = await this.prisma.payments.findFirst({
        where: {
          order_id: order.id,
          state: { in: [...SETTLED_PAYMENT_STATES] as payments_state_enum[] },
        },
        select: { id: true },
      });
      // Fiado abonos live in `ar_payments`, not in `payments` (T4b A2).
      const paidReceivable = settledPayment
        ? null
        : await this.prisma.accounts_receivable.findFirst({
            where: {
              source_type: { in: ['order', 'credit_sale'] },
              source_id: order.id,
              OR: [{ paid_amount: { gt: 0 } }, { ar_payments: { some: {} } }],
            },
            select: { id: true },
          });
      if (settledPayment || paidReceivable) {
        return {
          ...outcome,
          order_requires_refund: true,
          order_warning: `La orden ${label} ya tiene pagos registrados: no se canceló. Gestiona la devolución del pago desde la orden.`,
        };
      }

      // A gateway payment still in flight could settle after the cancel (T4b A3).
      const paymentInFlight = await this.prisma.payments.findFirst({
        where: {
          order_id: order.id,
          state: {
            in: [payments_state_enum.pending, payments_state_enum.authorized],
          },
        },
        select: { id: true },
      });
      if (paymentInFlight) {
        return warn(
          `La orden ${label} tiene un pago en proceso: no se canceló. Espera a que el pago se confirme o rechace y revisa la orden.`,
        );
      }

      const hasOtherProducts = (order.order_items ?? []).some(
        (item) => item.product_id !== booking.product_id,
      );
      const otherBookings = await this.prisma.bookings.count({
        where: {
          order_id: order.id,
          id: { not: booking.id },
          status: { notIn: [booking_status_enum.cancelled] },
        },
      });
      if (hasOtherProducts || otherBookings > 0) {
        return warn(
          `La orden ${label} incluye otros productos o reservas: no se canceló. Ajusta la orden manualmente.`,
        );
      }

      if (!(CANCELABLE_ORDER_STATES as readonly string[]).includes(order.state)) {
        return warn(
          `La orden ${label} está en estado "${order.state}" y no se canceló. Revísala manualmente.`,
        );
      }

      const cancelled = await this.compensateOrderForFailedBooking(
        order.id,
        `Reserva ${booking.booking_number} cancelada: se cancela su orden.`,
      );
      if (!cancelled) {
        return warn(
          `No se pudo cancelar la orden ${label}. Revísala manualmente.`,
        );
      }
      return { ...outcome, order_cancelled: true };
    } catch (err) {
      this.logger.error(
        `Could not release order ${booking.order_id} of booking ${booking.id}: ${(err as Error).message}`,
      );
      return warn(
        'No se pudo revisar la orden de la reserva. Revísala manualmente.',
      );
    }
  }

  async create(dto: CreateBookingDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new BadRequestException('No se encontro contexto de tienda');
    }

    await this.assertBookableSlot(store_id, dto, {
      allowOverride: dto.skip_availability_check === true,
    });

    // 1. Validar que el producto existe y requiere reserva
    const product = await this.prisma.products.findFirst({
      where: { id: dto.product_id },
      select: {
        ...BOOKING_PRODUCT_PRICING_SELECT,
        id: true,
        requires_booking: true,
        service_duration_minutes: true,
        booking_mode: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto/servicio no encontrado');
    }

    // Validate product_variant_id if provided
    let selectedVariant: BookingPricedVariant | null = null;
    if (dto.product_variant_id) {
      selectedVariant = await this.prisma.product_variants.findFirst({
        where: { id: dto.product_variant_id, product_id: dto.product_id },
        select: BOOKING_VARIANT_PRICING_SELECT,
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

    await this.assertReferencesInStore(store_id, {
      customer_id: dto.customer_id,
      order_id: dto.order_id,
      table_id: dto.table_id,
      service_address_id:
        dto.service_location_type === 'home' ? dto.service_address_id : null,
    });

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
      if ((await this.countActiveProviders(dto.product_id)) > 0) {
        // Auto-asignar el primer provider disponible
        const availableProviders =
          await this.availabilityService.getAvailableProvidersForSlot(
            dto.product_id,
            dto.date,
            dto.start_time,
            dto.end_time,
          );

        if (availableProviders.length === 0) {
          // QUI-966 S5: providers exist but all are busy → never book
          // without a provider (that was overbooking the slot).
          throw new ConflictException(
            'El horario solicitado no esta disponible',
          );
        }
        resolvedProviderId = availableProviders[0].id;
      }
      // If NO active providers configured at all, skip provider validation (legacy fallback)
    }

    // 3. Validar disponibilidad del slot (a menos que se indique lo contrario)
    const isFreeBooking =
      product.booking_mode === booking_mode_enum.free_booking;
    // Only reachable without a provider when the product has zero active
    // providers (legacy fallback) or the staff forced the booking.
    const noProvidersConfigured =
      !isFreeBooking && !resolvedProviderId && !dto.provider_id;
    const shouldSkipAvailability =
      dto.skip_availability_check || noProvidersConfigured;

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
    if (dto.customer_id) {
      await this.availabilityService.validateNoOverlapForCustomer(
        dto.customer_id,
        dto.date,
        dto.start_time,
        dto.end_time,
      );
    }

    // 5. Generar numero de reserva (se regenera dentro del tx si colisiona)
    let booking_number = await this.generateBookingNumber(store_id, dto.date);
    const initialBookingNumber = booking_number;

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
      preCreatedOrder = await this.preCreateBookingOrder({
        product,
        variant: selectedVariant,
        product_id: dto.product_id,
        product_variant_id: dto.product_variant_id,
        customer_id: dto.customer_id,
        booking_number,
        channel: dto.channel || 'pos',
        user_id: context?.user_id,
      });
    }

    let booking: Awaited<ReturnType<typeof this.mapBooking>> | null = null;
    try {
      booking = await this.runBookingWrite(
        async (tx, attempt) => {
          if (attempt > 0) {
            booking_number = await this.generateBookingNumber(
              store_id,
              dto.date,
              tx,
            );
          }

          // Re-verificar disponibilidad dentro de la transaccion (si aplica).
          // QUI-966 S5: por solapamiento, no por hora exacta.
          if (!shouldSkipAvailability) {
            await this.assertSlotStillFreeInTx(tx, {
              product_id: dto.product_id,
              date: dto.date,
              start_time: dto.start_time,
              end_time: dto.end_time,
              provider_id: resolvedProviderId,
              isFreeBooking,
            });
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
              // CP-POS-SVC-PERF-001 — cart-line anchor surfaced by the
              // POS scheduler so future re-orders can reattach the same
              // booking to its original cart row. Optional and persisted
              // verbatim.
              cart_item_id: dto.cart_item_id ?? null,
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
      );
    } catch (err) {
      // Compensar la orden pre-creada para preservar el invariante de
      // QUI-649: reserva y orden nacen juntas o no nacen. Si la
      // cancelación también falla (DB caída, lock), la orden queda en
      // 'created' huérfana — aceptable, mejor que el bug de "reserva
      // caída y orden persistida" que el plan repara.
      if (preCreatedOrder) {
        // OrdersService no expone `cancel()`; ver
        // `compensateOrderForFailedBooking`.
        await this.compensateOrderForFailedBooking(
          preCreatedOrder.id,
          `Compensación por fallo de reserva (booking_id=${preCreatedOrder.id}).`,
        );
      }
      throw err;
    }

    // La orden se creó con el número tentativo; si hubo que reasignarlo por
    // concurrencia, se corrige la nota (best effort, no rompe la reserva).
    if (preCreatedOrder && booking_number !== initialBookingNumber) {
      try {
        await this.prisma.orders.update({
          where: { id: preCreatedOrder.id },
          data: {
            internal_notes: `Reserva ${booking_number} (orden creada antes de la reserva)`,
          },
        });
      } catch (noteErr) {
        this.logger.warn(
          `Could not update order ${preCreatedOrder.id} note to ${booking_number}: ${noteErr.message}`,
        );
      }
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
    cart_item_id?: string;
    order_id?: number;
  }) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new BadRequestException('No se encontro contexto de tienda');
    }

    // Ecommerce hold: past / closed-hours can never be forced.
    await this.assertBookableSlot(store_id, dto);

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

    await this.assertReferencesInStore(store_id, {
      customer_id: dto.customer_id,
      order_id: dto.order_id,
    });

    if (dto.product_variant_id) {
      const variantOk = await this.prisma.product_variants.findFirst({
        where: { id: dto.product_variant_id, product_id: dto.product_id },
        select: { id: true },
      });
      if (!variantOk) {
        throw new BadRequestException('Variant does not belong to product');
      }
    }

    // QUI-966 S5: free_booking also checks its fixed capacity here.
    const isAvailable = await this.availabilityService.isSlotAvailable(
      dto.product_id,
      dto.date,
      dto.start_time,
      dto.end_time,
    );
    if (!isAvailable) {
      throw new ConflictException('El horario solicitado no esta disponible');
    }

    const HOLD_DURATION_MINUTES = 15;
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + HOLD_DURATION_MINUTES);

    const isFreeBooking =
      product.booking_mode === booking_mode_enum.free_booking;
    const booking = await this.runBookingWrite(async (tx) => {
      // T3 advisory B: same in-transaction capacity re-count as `create`.
      await this.assertSlotStillFreeInTx(tx, {
        product_id: dto.product_id,
        date: dto.date,
        start_time: dto.start_time,
        end_time: dto.end_time,
        isFreeBooking,
      });
      const booking_number = await this.generateBookingNumber(
        store_id,
        dto.date,
        tx,
      );
      return tx.bookings.create({
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
          // CP-POS-SVC-PERF-001 — cart-line anchor surfaced by the POS
          // scheduler so future re-orders can reattach the same booking
          // to its original cart row. Optional and persisted verbatim.
          cart_item_id: dto.cart_item_id ?? null,
          order_id: dto.order_id ?? null,
          notes: dto.notes,
          expires_at: expiresAt,
          created_by_user_id: context?.user_id,
          updated_at: new Date(),
        },
        include: this.BOOKING_INCLUDE,
      });
    });

    return await this.mapBooking(booking);
  }

  /**
   * Turns an ecommerce hold into a real booking (QUI-966 S14). The slot is
   * re-validated (same date/hours gate as `create`, availability excluding
   * the hold itself, and the in-transaction re-count), and the booking gets
   * its order priced on the server exactly like `create` does.
   */
  async confirmHold(id: number) {
    const booking = await this.findOne(id);

    if (booking.status !== booking_status_enum.pending) {
      throw new BadRequestException(
        `No se puede confirmar una reserva temporal en estado "${booking.status}"`,
      );
    }

    if (booking.expires_at && new Date(booking.expires_at) < new Date()) {
      await this.prisma.bookings.delete({ where: { id } });
      throw new BadRequestException(
        'La reserva temporal ha expirado. Por favor selecciona un horario nuevamente.',
      );
    }

    // Already confirmed (no expiry, order linked): idempotent.
    if (!booking.expires_at && booking.order_id) return booking;

    const date = dateOnlyString(new Date(booking.date));
    const slot = {
      date,
      start_time: booking.start_time,
      end_time: booking.end_time,
    };
    // Ecommerce: past / closed hours can never be forced.
    await this.assertBookableSlot(booking.store_id, slot);

    const isAvailable = await this.availabilityService.isSlotAvailable(
      booking.product_id,
      date,
      booking.start_time,
      booking.end_time,
      booking.provider_id ?? undefined,
      booking.id,
    );
    if (!isAvailable) {
      throw new ConflictException('El horario solicitado no esta disponible');
    }

    const product = await this.prisma.products.findFirst({
      where: { id: booking.product_id },
      select: { ...BOOKING_PRODUCT_PRICING_SELECT, booking_mode: true },
    });
    if (!product) {
      throw new NotFoundException('Producto/servicio no encontrado');
    }

    let preCreatedOrder: { id: number } | null = null;
    if (!booking.order_id) {
      const variant = booking.product_variant_id
        ? await this.prisma.product_variants.findFirst({
            where: {
              id: booking.product_variant_id,
              product_id: booking.product_id,
            },
            select: BOOKING_VARIANT_PRICING_SELECT,
          })
        : null;
      preCreatedOrder = await this.preCreateBookingOrder({
        product,
        variant,
        product_id: booking.product_id,
        product_variant_id: booking.product_variant_id,
        customer_id: booking.customer_id,
        booking_number: booking.booking_number,
        channel: booking.channel || 'ecommerce',
        user_id: RequestContextService.getContext()?.user_id,
      });
    }

    try {
      // `null` = a concurrent confirm-hold linked its order first (T4b A4).
      const confirmed = await this.runBookingWrite(async (tx) => {
        await this.assertSlotStillFreeInTx(tx, {
          ...slot,
          product_id: booking.product_id,
          provider_id: booking.provider_id,
          isFreeBooking:
            product.booking_mode === booking_mode_enum.free_booking,
          exclude_booking_id: booking.id,
        });
        const data = {
          expires_at: null,
          order_id: booking.order_id ?? preCreatedOrder?.id ?? null,
          updated_at: new Date(),
        };
        if (preCreatedOrder) {
          // Claim: only a hold still without order takes this call's order.
          const claim = await tx.bookings.updateMany({
            where: {
              id,
              order_id: null,
              status: booking_status_enum.pending,
            },
            data,
          });
          if (claim.count === 0) return null;
          const claimed = await tx.bookings.findUnique({
            where: { id },
            include: this.BOOKING_INCLUDE,
          });
          return await this.mapBooking(claimed);
        }
        const updated = await tx.bookings.update({
          where: { id },
          data,
          include: this.BOOKING_INCLUDE,
        });
        return await this.mapBooking(updated);
      });
      if (!confirmed) {
        if (preCreatedOrder) {
          await this.compensateOrderForFailedBooking(
            preCreatedOrder.id,
            `Confirmación duplicada de la reserva ${booking.booking_number}: se cancela la orden sobrante.`,
          );
          preCreatedOrder = null;
        }
        // Idempotent: the caller gets the booking the winner confirmed.
        return await this.findOne(id);
      }
      return confirmed;
    } catch (err) {
      if (preCreatedOrder) {
        await this.compensateOrderForFailedBooking(
          preCreatedOrder.id,
          `Compensación por fallo al confirmar la reserva ${booking.booking_number}.`,
        );
      }
      throw err;
    }
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
    return this.afterBookingCancelled(booking);
  }

  /**
   * QUI-966 S9 — side effects of a cancellation made from the customer's
   * email link. `BookingConfirmationService` already moved the booking to
   * `cancelled` atomically with the link's token; this runs the same
   * effects as `cancel` (order release per S7 + `booking.cancelled`).
   * Must run inside the booking's store context.
   */
  async completeLinkCancellation(id: number) {
    const booking = await this.findOne(id);
    return this.afterBookingCancelled(booking);
  }

  private async afterBookingCancelled(
    booking: Awaited<ReturnType<ReservationsService['findOne']>>,
  ) {
    // QUI-966 S7: release (or flag) the booking's order.
    const orderRelease = await this.releaseBookingOrder(booking);
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
    return { ...booking, ...orderRelease };
  }

  /**
   * Deletes a pending booking (store `DELETE /store/reservations/:id`) and
   * releases its order the same way `cancel` does (QUI-966 S7).
   */
  async remove(id: number) {
    const booking = await this.findOne(id);
    if (booking.status !== booking_status_enum.pending) {
      throw new BadRequestException(
        'Solo se pueden eliminar reservas en estado pendiente',
      );
    }
    await this.prisma.bookings.delete({ where: { id } });
    return this.releaseBookingOrder(booking);
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
    // QUI-966 S8: never before the appointment started (store timezone).
    const current = await this.findOne(id);
    const timezone = await resolveStoreTimezone(this.prisma, current.store_id);
    if (
      !isSlotStartInPast(
        {
          date: dateOnlyString(new Date(current.date)),
          start_time: current.start_time,
        },
        timezone,
      )
    ) {
      throw new BadRequestException(
        'No se puede marcar no-show antes de la hora de la cita',
      );
    }
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
    // QUI-966 S11: an overdue PENDING booking (never confirmed and never
    // attended) is archived by the job too. `pending → no_show` is allowed
    // ONLY here; the manual `noShow` endpoint keeps the state machine
    // (confirmed/arriving/attending only).
    await this.transition(id, 'no_show', ['pending']);
  }

  /**
   * Silent archive of an ecommerce hold whose `expires_at` passed without
   * `confirmHold` (QUI-966 S11). An expired hold never became an
   * appointment (it already stops holding the slot, see
   * `slotHoldingBookingWhere`, and `confirmHold` rejects it), so it is
   * closed as `cancelled`, not `no_show`, and does not count as an absence.
   * Its order is not touched: a hold is created before any order.
   */
  async archiveExpiredHold(id: number): Promise<void> {
    await this.transition(id, 'cancelled');
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
    await this.assertBookableSlot(booking.store_id, dto);

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

    // QUI-966 S14: `reopen_order` used to flip a cancelled order straight to
    // `processing` with a raw update (no stock re-reservation, no payment
    // check, customer-triggered). Reactivating a cancelled order is a staff
    // decision (`OrderFlowService.reactivateOrder`), so the reschedule is
    // rejected BEFORE the booking moves.
    if (dto.reopen_order === true && booking.order_id) {
      const order = await this.prisma.orders.findFirst({
        where: { id: booking.order_id },
        select: { state: true },
      });
      if (order?.state === 'cancelled') {
        throw new ConflictException(
          'El pedido de esta reserva está cancelado y no se puede reactivar al reprogramar. Contacta a la tienda para reactivarlo.',
        );
      }
    }

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
    await this.assertBookableSlot(booking.store_id, dto);

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

    // QUI-966 S13: the booking may have been cancelled/completed since the
    // request was made; only pending/confirmed bookings move.
    if (
      booking.status !== booking_status_enum.pending &&
      booking.status !== booking_status_enum.confirmed
    ) {
      throw new BadRequestException(
        `No se puede reprogramar una reserva en estado "${booking.status}"`,
      );
    }
    await this.assertBookableSlot(booking.store_id, {
      date: this.formatDateOnly(request.requested_date),
      start_time: request.requested_start_time,
      end_time: request.requested_end_time,
    });

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
   * Lectura agente (O-51): solicitudes de reagendamiento de la tienda con la
   * reserva y los actores hidratados. Espejo del `findMany` del controller
   * (`listRescheduleRequests`), movido al service para que la tool no toque
   * Prisma directo (patrón T1). `storeId` explícito: fail-closed si falta.
   */
  async listRescheduleRequestsForAgent(storeId: number, status?: string) {
    const where: any = { store_id: storeId };
    if (status && status !== 'all') {
      where.status = status;
    }
    return this.prisma.booking_reschedule_requests.findMany({
      where,
      orderBy: { requested_at: 'desc' },
      take: 200,
      include: {
        booking: {
          select: {
            id: true,
            booking_number: true,
            date: true,
            start_time: true,
            end_time: true,
            customer: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
                phone: true,
              },
            },
            product: { select: { id: true, name: true } },
            provider: { select: { id: true, display_name: true } },
          },
        },
        requested_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        decided_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
  }

  /**
   * Lectura agente (O-51): UNA solicitud por id, acotada a la tienda. El
   * preview de approve/reject la usa para nombrar la reserva y el slot
   * solicitado; `null` cuando no existe o es de otra tienda.
   */
  async getRescheduleRequestForAgent(storeId: number, requestId: number) {
    return this.prisma.booking_reschedule_requests.findFirst({
      where: { id: requestId, store_id: storeId },
      include: {
        booking: {
          select: {
            id: true,
            booking_number: true,
            date: true,
            start_time: true,
            end_time: true,
            status: true,
            customer: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
                phone: true,
              },
            },
            product: { select: { id: true, name: true } },
            provider: { select: { id: true, display_name: true } },
          },
        },
      },
    });
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
   * "Today" of the current store (QUI-966 S12) as a `bookings.date` window.
   *
   * The civil day is the STORE's calendar day (store timezone), so from
   * 19:00 Bogota (00:00Z) "today" does not jump to tomorrow. `bookings.date`
   * is `@db.Date` stored as UTC midnight, so the bounds are that civil day
   * at UTC midnight (never local midnight, which would miss the row).
   */
  private async storeTodayWindow(): Promise<{
    todayStart: Date;
    todayEnd: Date;
  }> {
    const store_id = RequestContextService.getContext()?.store_id;
    const timezone = store_id
      ? await resolveStoreTimezone(this.prisma, store_id)
      : DEFAULT_STORE_TIMEZONE;
    const today = localDateString(new Date(), timezone);
    const todayStart = new Date(`${today}T00:00:00.000Z`);
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
    return { todayStart, todayEnd };
  }

  /**
   * Obtiene estadisticas de reservas. "Hoy" es el día de la tienda
   * (`storeTodayWindow`).
   */
  async getStats() {
    const { todayStart, todayEnd } = await this.storeTodayWindow();

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
   * Obtiene las reservas de hoy (día de la tienda) ordenadas por hora de
   * inicio. Ver `storeTodayWindow`.
   */
  async getToday() {
    const { todayStart, todayEnd } = await this.storeTodayWindow();

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

    // QUI-966 S8: check-in only on the appointment's day (store timezone).
    const timezone = await resolveStoreTimezone(this.prisma, booking.store_id);
    if (
      dateOnlyString(new Date(booking.date)) !==
      localDateString(new Date(), timezone)
    ) {
      throw new BadRequestException(
        'Solo se puede hacer check-in el día de la cita',
      );
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
  private async transition(
    id: number,
    targetStatus: string,
    extraAllowedFrom: string[] = [],
  ) {
    const booking = await this.findOne(id);
    const allowed = this.VALID_TRANSITIONS[booking.status] || [];

    if (
      !allowed.includes(targetStatus) &&
      !extraAllowedFrom.includes(booking.status)
    ) {
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
   * Genera un numero de reserva: BKG-YYYYMMDD-XXXX (QUI-966 S6).
   *
   * El máximo es numérico (después de 9999 viene 10000, que como texto ordena
   * antes). Dos escrituras concurrentes pueden leer el mismo máximo: el
   * índice único `(store_id, booking_number)` lo detecta y `runBookingWrite`
   * reintenta regenerando el número dentro de la transacción (`db`).
   */
  private async generateBookingNumber(
    store_id: number,
    date: string,
    db: Pick<Prisma.TransactionClient, 'bookings'> = this.prisma,
  ): Promise<string> {
    const targetDate = new Date(date);
    const year = targetDate.getUTCFullYear().toString();
    const month = (targetDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = targetDate.getUTCDate().toString().padStart(2, '0');
    const prefix = `BKG-${year}${month}${day}-`;

    const sameDay = await db.bookings.findMany({
      where: {
        store_id,
        booking_number: { startsWith: prefix },
      },
      select: { booking_number: true },
    });

    return nextSequenceNumber(
      (sameDay ?? []).map((b) => b.booking_number),
      prefix,
    );
  }

  /**
   * QUI-966 S5/S6 — runs a booking write inside a Serializable transaction.
   * A serialization failure (P2034/40001: a concurrent booking touched the
   * same slot) or a `booking_number` collision (P2002) is retried with a
   * short jittered pause; `work` receives the attempt so it can regenerate
   * the number. When retries run out the caller gets a 409, never a 500.
   */
  private async runBookingWrite<T>(
    work: (tx: Prisma.TransactionClient, attempt: number) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx: Prisma.TransactionClient) => work(tx, attempt),
          { isolationLevel: 'Serializable' },
        );
      } catch (err) {
        const numberTaken = isUniqueViolationOn(err, 'booking_number');
        if (!numberTaken && !isSerializationFailure(err)) throw err;
        if (attempt + 1 >= ReservationsService.BOOKING_WRITE_ATTEMPTS) {
          throw new ConflictException(
            numberTaken
              ? 'No se pudo asignar el numero de reserva, intenta de nuevo'
              : 'El horario ya no esta disponible (reservado por otro usuario)',
          );
        }
        await retryBackoff(attempt);
      }
    }
  }

  private static readonly BOOKING_WRITE_ATTEMPTS = 5;
}
