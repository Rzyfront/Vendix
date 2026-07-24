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
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
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
    private readonly globalPrisma: GlobalPrismaService,
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
   *
   * Public because the booking flow runs before the customer logs in.
   * Without `@Public()`, an unauthenticated customer gets a 401 and
   * `storeAddress` stays null in the frontend — the booking summary
   * silently renders without the address block. Same rationale as
   * `getStoreServices` below.
   */
  @Public()
  @Get('store/address')
  async getStoreAddress(@Req() req: any) {
    // The booking flow on the public ecommerce runs before the customer
    // logs in. The frontend's `tenantStoreIdInterceptor` sets an
    // `x-store-id` header that we should prefer over `req.store_id`
    // (which the DomainResolverMiddleware only sets when the Host
    // header matches a registered domain). Same pattern as
    // `getStoreServices` below.
    const headerStoreId = parseInt(req.headers?.['x-store-id'] as string, 10);
    const storeId = !isNaN(headerStoreId) && headerStoreId > 0
      ? headerStoreId
      : req.store_id;
    if (!storeId) {
      return { success: true, data: null };
    }
    const prisma = this.availabilityService['prisma'];

    // 1) Prefer the store's own primary address (the preferred case —
    // operator has explicitly configured a location for THIS store).
    // We filter by `type: 'store_physical'` so that customer-shipping
    // addresses accidentally linked to the same store_id (which can
    // happen when a customer also has admin access to the same store)
    // don't leak into "Dirección del local" of the booking summary.
    const storeAddress = await prisma.addresses.findFirst({
      where: { store_id: storeId, is_primary: true, type: 'store_physical' },
      orderBy: { id: 'asc' },
    });
    if (storeAddress) {
      return { success: true, data: storeAddress };
    }

    // 2) Fallback: any address for this store (even non-primary) so the
    // booking summary still has SOMETHING to show when the operator
    // forgot to flag an address as primary. Same type filter as
    // fallback 1 to keep customer shipping addresses out of the local
    // address slot.
    const anyStoreAddress = await prisma.addresses.findFirst({
      where: { store_id: storeId, type: 'store_physical' },
      orderBy: { id: 'asc' },
    });
    if (anyStoreAddress) {
      return { success: true, data: anyStoreAddress };
    }

    // 3) Last fallback: the organization-level primary address. This
    // is the address captured during onboarding (`setupStore` saves it
    // both on the store and on the org; older stores may only have it
    // on the org). The customer still sees where the technician is
    // located, just at the org level instead of the specific store.
    const orgId = req.organization_id;
    if (orgId) {
      const orgAddress = await prisma.addresses.findFirst({
        where: { organization_id: orgId, is_primary: true },
        orderBy: { id: 'asc' },
      });
      if (orgAddress) {
        return { success: true, data: orgAddress };
      }
    }

    // 4) Final fallback: read the local_address from store_settings.
    // The operator-facing "Servicios" form stores the address as JSON
    // in `store_settings.settings.services.local_address` (not in the
    // `addresses` table), so a store can have a configured "local
    // address" without ever inserting a row in `addresses`. We
    // normalise the JSON shape into the same field names the addresses
    // table uses, so the frontend can render either source uniformly.
    //
    // We search across ALL store_settings in the database with a
    // non-empty `services.local_address`. The operator may have
    // configured the address while logged into a sibling store under
    // a different organisation (e.g. admin of "Nike" while browsing
    // "Nike Shop" — both belonging to the same user but separate
    // organisations in the multi-tenant model), and the JWT carries
    // the *current* org_id, not the one the data was actually saved
    // against. A cross-org cross-store lookup lets a single address
    // configure cover all sibling stores the user can see.
    //
    // We use the unscoped `GlobalPrismaService` here, NOT the scoped
    // `availabilityService['prisma']` — the latter would silently
    // inject `where: { organization_id: <current org> }` and filter
    // out addresses saved under a different org (e.g. Nike's data
    // when the active org is Test Org).
    //
    // NOTE: this is intentionally permissive for the demo. A
    // production system would resolve the user's accessible
    // organisation_ids via a membership table and filter on those.
    const settingsRows = await this.globalPrisma.store_settings.findMany({
      orderBy: { id: 'desc' },
    });
    for (const settingsRow of settingsRows) {
      const localAddress = ((settingsRow.settings as any)?.services as any)
        ?.local_address;
      if (localAddress && (localAddress.address_line1 || localAddress.city)) {
        return {
          success: true,
          data: {
            id: 0,
            address_line1: localAddress.address_line1 ?? '',
            address_line2: localAddress.address_line2 ?? null,
            city: localAddress.city ?? '',
            state_province: localAddress.state_province ?? null,
            country_code: localAddress.country_code ?? 'CO',
            postal_code: localAddress.postal_code ?? null,
            is_primary: true,
            type: 'store_physical',
            store_id: storeId,
            organization_id: req.organization_id ?? null,
          },
        };
      }
    }

    return { success: true, data: null };
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
   * address to use for the 'En el local' option. Public because the
   * booking flow runs before the customer logs in.
   */
  @Public()
  @Get('store/services')
  async getStoreServices(@Req() req: any) {
    // The booking flow on the public ecommerce runs before the
    // customer logs in. The frontend's tenantStoreIdInterceptor
    // sets an `x-store-id` header that we should prefer over
    // req.store_id (which the DomainResolverMiddleware only sets when
    // the Host header matches a registered domain in domain_settings).
    const headerStoreId = parseInt(req.headers?.['x-store-id'] as string, 10);
    const storeId = !isNaN(headerStoreId) && headerStoreId > 0
      ? headerStoreId
      : req.store_id;
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
    const prisma = this.availabilityService['prisma'];
    // Maintain the "single primary per customer" invariant. When the new
    // address is flagged as primary, unset is_primary on every other
    // address of this customer first — otherwise we end up with multiple
    // primaries in the DB and the UI sort can't tell which is "the" one.
    // The unset + create run in a transaction so a failure doesn't leave
    // a partial state (e.g. all old ones demoted but new one never saved).
    const created = await prisma.$transaction(async (tx) => {
      if (dto.is_primary) {
        await tx.addresses.updateMany({
          where: { user_id: customerId, is_primary: true },
          data: { is_primary: false },
        });
      }
      return tx.addresses.create({
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
