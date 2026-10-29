import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { LodgingBookingEngineService } from '../../store/hospitality/reservations/booking-engine/booking-engine.service';
import {
  BookingSearchDto,
  CreateBookingHoldDto,
} from '../../store/hospitality/reservations/booking-engine/booking-engine.dto';
import { LodgingPrecheckinService } from '../../store/hospitality/reservations/precheckin/precheckin.service';
import { PrecheckinSubmitDto } from '../../store/hospitality/reservations/precheckin/precheckin.dto';

/**
 * Hospitality Suite (H6.6) — the hotel's booking engine in its storefront.
 * The store comes from the storefront domain; searching is public, holding
 * a room and reading its status need the logged-in customer. The online
 * check-in (H8.1) works with its link token alone.
 */
@Controller('ecommerce/hospitality')
export class EcommerceHospitalityController {
  constructor(
    private readonly bookingEngine: LodgingBookingEngineService,
    private readonly precheckin: LodgingPrecheckinService,
  ) {}

  @Public()
  @Get('search')
  @Header('Cache-Control', 'no-store')
  async search(@Query() query: BookingSearchDto) {
    return { success: true, data: await this.bookingEngine.search(query) };
  }

  @Post('holds')
  async hold(@Req() req: { user?: { id?: number } }, @Body() dto: CreateBookingHoldDto) {
    return { success: true, data: await this.bookingEngine.hold(this.customerId(req), dto) };
  }

  @Get('reservations/:id')
  @Header('Cache-Control', 'no-store')
  async findOne(@Req() req: { user?: { id?: number } }, @Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.bookingEngine.findForCustomer(id, this.customerId(req)) };
  }

  /** H8.1 — online check-in: the link token is the only credential. */
  @Public()
  @Get('precheckin/:token')
  @Header('Cache-Control', 'no-store')
  async findPrecheckin(@Param('token') token: string) {
    return { success: true, data: await this.precheckin.findByToken(token) };
  }

  @Public()
  @Post('precheckin/:token')
  @Header('Cache-Control', 'no-store')
  async submitPrecheckin(@Param('token') token: string, @Body() dto: PrecheckinSubmitDto) {
    return {
      success: true,
      message: 'Pre-registro recibido',
      data: await this.precheckin.submit(token, dto),
    };
  }

  private customerId(req: { user?: { id?: number } }): number {
    const id = req.user?.id;
    if (!id) throw new ForbiddenException('Debes iniciar sesión para reservar');
    return id;
  }
}
