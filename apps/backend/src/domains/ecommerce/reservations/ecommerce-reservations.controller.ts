import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  ParseIntPipe,
  Header,
  ForbiddenException,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { order_channel_enum } from '@prisma/client';
import { Public } from '@common/decorators/public.decorator';
import { AvailabilityService } from '../../store/reservations/availability.service';
import { ReservationsService } from '../../store/reservations/reservations.service';
import { ProvidersService } from '../../store/reservations/providers/providers.service';
import {
  AvailabilityQueryDto,
  RescheduleBookingDto,
  CheckInDto,
} from '../../store/reservations/dto';
import { CreateEcommerceBookingDto } from './dto/create-ecommerce-booking.dto';
import { HoldBookingDto } from './dto/hold-booking.dto';

@Controller('ecommerce/reservations')
export class EcommerceReservationsController {
  constructor(
    private readonly availabilityService: AvailabilityService,
    private readonly reservationsService: ReservationsService,
    private readonly providersService: ProvidersService,
  ) {}

  @Public()
  @Get('availability/:productId')
  @Header('Cache-Control', 'no-store')
  async getAvailability(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: AvailabilityQueryDto,
    @Query('provider_id') providerId?: string,
  ) {
    const slots = await this.availabilityService.getAvailableSlots(
      productId,
      query.date_from,
      query.date_to,
      {
        provider_id: providerId ? parseInt(providerId, 10) : undefined,
        product_variant_id: query.product_variant_id,
      },
    );
    return { success: true, data: slots };
  }

  @Public()
  @Get('providers/:productId')
  async getProvidersForService(
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    const providers =
      await this.providersService.getProvidersForService(productId);
    return { success: true, data: providers };
  }

  /**
   * Public overview endpoint used by the BookingCalendarComponent to paint
   * the green/red day grid without making N slot-fetch calls. Returns, for
   * each day in the requested range, whether the day has any available slot
   * (after applying provider_schedules + provider_exceptions + existing
   * bookings + store_business_hours).
   *
   * Query params:
   *   - date_from (ISO), date_to (ISO)  → inclusive range
   *   - provider_id (int, optional)    → filter by provider
   *
   * Response: `Array<{ date: string; has_slots: boolean; slots_count: number }>`
   */
  @Public()
  @Get('availability-overview/:productId')
  @Header('Cache-Control', 'no-store')
  async getAvailabilityOverview(
    @Param('productId', ParseIntPipe) productId: number,
    @Query('date_from') dateFrom: string,
    @Query('date_to') dateTo: string,
    @Query('provider_id') providerId?: string,
  ) {
    if (!dateFrom || !dateTo) {
      throw new BadRequestException('date_from y date_to son obligatorios');
    }
    const pid = providerId ? parseInt(providerId, 10) : undefined;
    const days = await this.availabilityService.getDayAvailabilityOverview(
      productId,
      dateFrom,
      dateTo,
      pid,
    );
    return { success: true, data: days };
  }

  /**
   * Returns the addresses saved for the currently-authenticated customer
   * so the booking flow can show them when the customer picks "a domicilio".
   * Customer auth via JWT (EcommerceAuthGuard on the route layer).
   */
  @Get('customer/addresses')
  async getCustomerAddresses(@Req() req: any) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new ForbiddenException(
        'Debe iniciar sesion para ver sus direcciones',
      );
    }
    // Reuse the existing EcommerceBookingService if it has the helper;
    // otherwise inline a scoped query here. We use the unscoped client
    // because addresses is store-scoped and the customer only sees their
    // own rows.
    const rows = await this.availabilityService['prisma'].addresses.findMany({
      where: { user_id: customerId },
      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
    });
    return { success: true, data: rows };
  }

  /**
   * Returns the technician's local address (the store's primary
   * shipping address) so the booking flow can show it when the customer
   * picks "en el local".
   */
  @Get('store/address')
  async getStoreAddress(@Req() req: any) {
    const storeId = req.store_id;
    if (!storeId) {
      return { success: true, data: null };
    }
    const row = await this.availabilityService['prisma'].addresses.findFirst({
      where: { store_id: storeId, is_primary: true },
      orderBy: { id: 'asc' },
    });
    return { success: true, data: row };
  }

  /**
   * Returns the store's service configuration captured in
   * Configuración → General → Servicios:
   *   - offer_home_service: bool — whether the customer can request
   *     'A domicilio' (false → only 'En el local' option is shown).
   *   - local_address: object — captured address of the technician's
   *     local.
   *
   * The booking flow's ServiceLocationSelectorComponent reads this to
   * decide whether to render the 'A domicilio' radio card and which
   * address to use for the 'En el local' option.
   */
  @Get('store/services')
  async getStoreServices(@Req() req: any) {
    const storeId = req.store_id;
    if (!storeId) {
      return {
        success: true,
        data: { offer_home_service: true, local_address: null },
      };
    }
    // Use the unscoped client for the cross-tenant read so the
    // booking flow can show the right option without requiring a
    // store context.
    const row = await this.availabilityService['prisma'].store_settings.findFirst({
      where: { store_id: storeId },
      orderBy: { id: 'desc' },
    });
    const settings = (row?.settings as any) ?? {};
    const services = settings.services ?? {};
    return {
      success: true,
      data: {
        offer_home_service:
          services.offer_home_service !== false, // default true
        local_address: services.local_address ?? null,
      },
    };
  }

  /**
   * Creates a new address for the authenticated customer (used by the
   * "Agregar nueva dirección" inline form in the booking flow).
   * Auto-flags the row with the customer's user_id and (if requested)
   * is_primary = true.
   */
  @Post('customer/addresses')
  async createCustomerAddress(@Req() req: any, @Body() dto: any) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new ForbiddenException(
        'Debe iniciar sesion para crear una direccion',
      );
    }
    if (!dto?.address_line1 || !dto?.city || !dto?.country_code) {
      throw new BadRequestException(
        'address_line1, city y country_code son obligatorios',
      );
    }
    const created = await this.availabilityService['prisma'].addresses.create({
      data: {
        address_line1: dto.address_line1,
        address_line2: dto.address_line2 ?? null,
        city: dto.city,
        state_province: dto.state_province ?? null,
        country_code: dto.country_code,
        postal_code: dto.postal_code ?? null,
        phone_number: dto.phone_number ?? null,
        user_id: customerId,
        is_primary: !!dto.is_primary,
        type: 'shipping',
      },
    });
    return { success: true, data: created };
  }

  @Post()
  async createBooking(@Req() req: any, @Body() dto: CreateEcommerceBookingDto) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new ForbiddenException(
        'Debe iniciar sesion para crear una reserva',
      );
    }

    const booking = await this.reservationsService.create({
      customer_id: customerId,
      product_id: dto.product_id,
      product_variant_id: dto.product_variant_id,
      date: dto.date,
      start_time: dto.start_time,
      end_time: dto.end_time,
      channel: order_channel_enum.ecommerce,
      notes: dto.notes,
    });

    return { success: true, data: booking };
  }

  @Post('hold')
  async holdBooking(@Req() req: any, @Body() dto: HoldBookingDto) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new ForbiddenException('Debe iniciar sesion para reservar');
    }

    const hold = await this.reservationsService.hold({
      customer_id: customerId,
      product_id: dto.product_id,
      product_variant_id: dto.product_variant_id,
      date: dto.date,
      start_time: dto.start_time,
      end_time: dto.end_time,
      notes: dto.notes,
    });

    return { success: true, data: hold };
  }

  @Post(':id/confirm-hold')
  async confirmHold(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new ForbiddenException('Debe iniciar sesion');
    }

    const booking = await this.reservationsService.findOne(id);
    if (booking.customer_id !== customerId) {
      throw new ForbiddenException('No tiene permiso sobre esta reserva');
    }

    const confirmed = await this.reservationsService.confirmHold(id);
    return { success: true, data: confirmed };
  }

  @Get('my')
  async getMyBookings(@Req() req: any) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new ForbiddenException('Debe iniciar sesion para ver sus reservas');
    }

    const result = await this.reservationsService.findAll({
      customer_id: customerId,
      sort_by: 'date',
      sort_order: 'desc',
    });

    return { success: true, data: result.data, pagination: result.pagination };
  }

  @Post(':id/cancel')
  async cancelBooking(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new ForbiddenException(
        'Debe iniciar sesion para cancelar una reserva',
      );
    }

    const booking = await this.reservationsService.findOne(id);
    if (booking.customer_id !== customerId) {
      throw new ForbiddenException(
        'No tiene permiso para cancelar esta reserva',
      );
    }

    if (booking.status !== 'pending' && booking.status !== 'confirmed') {
      throw new BadRequestException(
        'Solo se pueden cancelar reservas pendientes o confirmadas',
      );
    }

    const result = await this.reservationsService.cancel(id);
    return { success: true, data: result };
  }

  @Post(':id/reschedule')
  async rescheduleBooking(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Body() dto: RescheduleBookingDto,
  ) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new ForbiddenException(
        'Debe iniciar sesion para reprogramar una reserva',
      );
    }

    const booking = await this.reservationsService.findOne(id);
    if (booking.customer_id !== customerId) {
      throw new ForbiddenException(
        'No tiene permiso para reprogramar esta reserva',
      );
    }

    const result = await this.reservationsService.reschedule(id, dto);
    return { success: true, data: result };
  }

  /**
   * Customer self check-in. Authenticates the customer via the ecommerce
   * JWT, verifies booking ownership, then delegates to
   * `ReservationsService.checkIn` with `source='customer'` so the event
   * payload carries that provenance for queue recomputation and the
   * notifications listener.
   */
  @Post(':id/check-in')
  async clientCheckIn(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Body() dto: CheckInDto,
  ) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new ForbiddenException(
        'Debe iniciar sesion para registrar su llegada',
      );
    }

    const booking = await this.reservationsService.findOne(id);
    if (booking.customer_id !== customerId) {
      throw new ForbiddenException('No tiene permiso sobre esta reserva');
    }

    const result = await this.reservationsService.checkIn(id, 'customer');
    return {
      success: true,
      data: result,
      arrival_notes: dto.arrival_notes ?? null,
    };
  }
}
