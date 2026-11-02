import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { readPublishedBookingPage } from './booking-page.reader';
import { BookingCheckinService } from './booking-checkin.service';

/**
 * Public side of the store's booking page, for the STORE_BOOKING app.
 * Under `/ecommerce/` so the domain resolver middleware sets the store from
 * the hostname; the store never comes from the client.
 *
 * Search, hold, payment and the check-in form itself are the PMS booking
 * engine (`/ecommerce/hospitality/*`), unchanged. This controller only says
 * whether the page is published (and its secondary products) and, for the
 * logged-in guest, whether a reservation can do its online check-in now.
 */
@Controller('ecommerce/booking-page')
export class BookingPublicController {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly checkin: BookingCheckinService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get()
  async get() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    const page = await readPublishedBookingPage(this.globalPrisma, storeId);
    if (!page) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    }
    return this.responseService.success({
      product_ids: page.products.map((p) => p.id),
    });
  }

  /** The guest's own reservation only (404 otherwise, like the PMS status page). */
  @Get('reservations/:id/checkin')
  @Header('Cache-Control', 'no-store')
  async checkinFor(
    @Req() req: { user?: { id?: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new ForbiddenException('Debes iniciar sesión para ver tu reserva');
    }
    return this.responseService.success(
      await this.checkin.forCustomer(id, customerId),
    );
  }
}
