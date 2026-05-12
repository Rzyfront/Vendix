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
}
