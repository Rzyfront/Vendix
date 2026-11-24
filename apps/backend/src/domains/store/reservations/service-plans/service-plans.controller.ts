import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ServicePlansService } from './service-plans.service';
import {
  CreatePlanActivityDto,
  CreatePlanDepartureDto,
  PlanQueryDto,
  ReorderPlanActivitiesDto,
  ReplacePlanPaxPricesDto,
  UpdatePlanActivityDto,
  UpdatePlanDepartureDto,
} from './dto/service-plan.dto';

/**
 * QUI-1060 modo Plan: tramos de precio por tamaño de grupo y salidas fijas de un
 * servicio con precio tipo paquete. Lectura para quien gestiona productos o
 * reservas; escritura con el permiso de editar productos.
 */
@Controller('store/service-plans')
@UseGuards(PermissionsGuard)
export class ServicePlansController {
  constructor(
    private readonly servicePlans: ServicePlansService,
    private readonly responseService: ResponseService,
  ) {}

  /** Comprobante: evento, ida y regreso, grupo e itinerario público de una reserva de plan (null si no es plan). */
  @Get('bookings/:bookingId/itinerary')
  @Permissions('store:reservations:read')
  async getBookingItinerary(@Param('bookingId', ParseIntPipe) bookingId: number) {
    const itinerary = await this.servicePlans.getBookingItinerary(bookingId);
    return this.responseService.success(itinerary, 'Itinerario de la reserva obtenido');
  }

  @Get(':productId')
  @Permissions('store:products:read', 'store:reservations:read')
  async getPlan(@Param('productId', ParseIntPipe) productId: number, @Query() query: PlanQueryDto) {
    const plan = await this.servicePlans.getPlan(productId, query.include_past === true);
    return this.responseService.success(plan, 'Plan obtenido');
  }

  @Put(':productId/pax-prices')
  @Permissions('store:products:update')
  async replacePaxPrices(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: ReplacePlanPaxPricesDto,
  ) {
    const tiers = await this.servicePlans.replacePaxPrices(productId, dto.tiers);
    return this.responseService.success(tiers, 'Tramos de precio guardados');
  }

  @Post(':productId/departures')
  @Permissions('store:products:update')
  async createDeparture(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: CreatePlanDepartureDto,
  ) {
    const departure = await this.servicePlans.createDeparture(productId, dto);
    return this.responseService.success(departure, 'Evento creado');
  }

  @Patch(':productId/departures/:departureId')
  @Permissions('store:products:update')
  async updateDeparture(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('departureId', ParseIntPipe) departureId: number,
    @Body() dto: UpdatePlanDepartureDto,
  ) {
    const departure = await this.servicePlans.updateDeparture(productId, departureId, dto);
    return this.responseService.success(departure, 'Evento actualizado');
  }

  // ---- Itinerario (QUI-1060 F2) ----

  @Post(':productId/activities')
  @Permissions('store:products:update')
  async createActivity(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: CreatePlanActivityDto,
  ) {
    const activity = await this.servicePlans.createActivity(productId, dto);
    return this.responseService.success(activity, 'Actividad agregada');
  }

  // Antes de `:activityId`: la ruta estática gana.
  @Put(':productId/activities/reorder')
  @Permissions('store:products:update')
  async reorderActivities(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: ReorderPlanActivitiesDto,
  ) {
    const activities = await this.servicePlans.reorderActivities(productId, dto.day_number, dto.activity_ids);
    return this.responseService.success(activities, 'Orden del día guardado');
  }

  @Patch(':productId/activities/:activityId')
  @Permissions('store:products:update')
  async updateActivity(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('activityId', ParseIntPipe) activityId: number,
    @Body() dto: UpdatePlanActivityDto,
  ) {
    const activity = await this.servicePlans.updateActivity(productId, activityId, dto);
    return this.responseService.success(activity, 'Actividad actualizada');
  }

  @Delete(':productId/activities/:activityId')
  @Permissions('store:products:update')
  async deleteActivity(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('activityId', ParseIntPipe) activityId: number,
  ) {
    const result = await this.servicePlans.deleteActivity(productId, activityId);
    return this.responseService.success(result, 'Actividad eliminada');
  }
}
