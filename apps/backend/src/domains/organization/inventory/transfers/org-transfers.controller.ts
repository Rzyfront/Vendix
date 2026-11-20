import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';

import { OrgTransfersService } from './org-transfers.service';
import { OrgTransferQueryDto } from './dto/org-transfer-query.dto';
import { CreateOrgTransferDto } from './dto/create-org-transfer.dto';
import { CompleteOrgTransferDto } from './dto/complete-org-transfer.dto';
import { CancelOrgTransferDto } from './dto/cancel-org-transfer.dto';
import { DispatchOrgTransferDto } from './dto/dispatch-org-transfer.dto';
import { CloseTransferWithLossDto } from '../../../store/orders/stock-transfers/dto/transfer-advanced.dto';

/**
 * `/api/organization/inventory/transfers` — org-level stock transfer
 * lifecycle (Plan P2.4).
 *
 * Five-step lifecycle (TWO-STEP approve+dispatch, §13#1):
 *   POST  /                  → create (logical: pending)
 *   POST  /:id/approve       → approve (no stock change)
 *   POST  /:id/dispatch      → decrement origin (logical: in_transit)
 *   POST  /:id/complete      → increment destination (logical: received)
 *   POST  /:id/cancel        → cancel; if in_transit returns origin stock
 *   POST  /complete          → movimiento rápido: crea y aplica en una transacción
 *   GET   /search-products   → picker del movimiento rápido
 *
 * Reads are inherited from the previous read-only iteration (`/`, `/:id`,
 * `/stats`).
 *
 * Permissions follow the standard
 * `organization:inventory:transfers:{action}` pattern (seeded in
 * `permissions-roles.seed.ts` — NOT touched in this round).
 */
@Controller('organization/inventory/transfers')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgTransfersController {
  constructor(
    private readonly transfers: OrgTransfersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('stats')
  @Permissions('organization:inventory:transfers:read')
  async getStats() {
    const data = await this.transfers.getStats();
    return this.responseService.success(
      data,
      'Estadísticas de traslados obtenidas',
    );
  }

  @Get()
  @Permissions('organization:inventory:transfers:read')
  async findAll(@Query() query: OrgTransferQueryDto) {
    const result = await this.transfers.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Traslados obtenidos exitosamente',
    );
  }

  /**
   * Picker del movimiento rápido: productos/variantes con stock en el origen y
   * su disponible en origen y destino. Declarado antes de `:id` para que la
   * ruta literal gane sobre el parámetro.
   */
  @Get('search-products')
  @Permissions('organization:inventory:transfers:read')
  async searchTransferableProducts(
    @Query('search') search: string,
    @Query('from_location_id', ParseIntPipe) fromLocationId: number,
    @Query('to_location_id', ParseIntPipe) toLocationId: number,
    @Query('limit') limit?: string,
  ) {
    const data = await this.transfers.searchTransferableProducts(
      search ?? '',
      fromLocationId,
      toLocationId,
      limit ? +limit : 20,
    );
    return this.responseService.success(data, 'Productos transferibles');
  }

  @Get(':id')
  @Permissions('organization:inventory:transfers:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.transfers.findOne(id);
    return this.responseService.success(data, 'Traslado obtenido');
  }

  @Post()
  @Permissions('organization:inventory:transfers:create')
  async create(@Body() dto: CreateOrgTransferDto) {
    const data = await this.transfers.create(dto);
    return this.responseService.success(
      data,
      'Traslado creado exitosamente',
    );
  }

  /**
   * Movimiento rápido (D1): crea y aplica la transferencia en una transacción
   * (origen −, destino +). Mueve stock de inmediato, por eso exige el permiso
   * de despacho —el que autoriza sacar stock del origen— y no solo el de crear.
   */
  @Post('complete')
  @Permissions('organization:inventory:transfers:dispatch')
  async createAndComplete(@Body() dto: CreateOrgTransferDto) {
    const data = await this.transfers.createAndComplete(dto);
    return this.responseService.success(
      data,
      'Movimiento aplicado: el inventario ya se movió',
    );
  }

  @Post(':id/approve')
  @Permissions('organization:inventory:transfers:approve')
  async approve(@Param('id', ParseIntPipe) id: number) {
    const data = await this.transfers.approve(id);
    return this.responseService.success(data, 'Traslado aprobado');
  }

  @Post(':id/dispatch')
  @Permissions('organization:inventory:transfers:dispatch')
  async dispatch(
    @Param('id', ParseIntPipe) id: number,
    @Body() body?: DispatchOrgTransferDto,
  ) {
    const data = await this.transfers.dispatch(id, body);
    return this.responseService.success(data, 'Traslado despachado');
  }

  @Post(':id/complete')
  @Permissions('organization:inventory:transfers:complete')
  async complete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteOrgTransferDto,
  ) {
    const data = await this.transfers.complete(id, dto);
    return this.responseService.success(data, 'Traslado recibido');
  }

  /**
   * D4 — recepción repetible con conteos por línea. `complete` queda como
   * alias para los clientes actuales.
   */
  @Post(':id/receive')
  @Permissions('organization:inventory:transfers:complete')
  async receive(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteOrgTransferDto,
  ) {
    const data = await this.transfers.receive(id, dto);
    return this.responseService.success(data, 'Traslado recibido');
  }

  /**
   * D4 — cierre del saldo pendiente como pérdida. Exige motivo y que la fecha
   * límite de entrega ya haya vencido; lo valida el servicio.
   */
  @Post(':id/close-with-loss')
  @Permissions('organization:inventory:transfers:complete')
  async closeWithLoss(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseTransferWithLossDto,
  ) {
    const data = await this.transfers.closeWithLoss(
      id,
      dto.reason,
      dto.notes,
    );
    return this.responseService.success(
      data,
      'Saldo pendiente cerrado como pérdida',
    );
  }

  @Post(':id/cancel')
  @Permissions('organization:inventory:transfers:cancel')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CancelOrgTransferDto,
  ) {
    const data = await this.transfers.cancel(id, body ?? {});
    return this.responseService.success(data, 'Traslado cancelado');
  }
}
