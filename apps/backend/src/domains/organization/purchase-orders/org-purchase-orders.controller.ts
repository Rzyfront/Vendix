import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { SkipSubscriptionGate } from '../../store/subscriptions/decorators/skip-subscription-gate.decorator';

import { OrgPurchaseOrdersService } from './org-purchase-orders.service';
import { OrgPurchaseOrderQueryDto } from './dto/org-purchase-order-query.dto';
import { CreateOrgPurchaseOrderDto } from './dto/create-org-purchase-order.dto';
import { ReceivePurchaseOrderDto } from '../../store/orders/purchase-orders/dto/receive-purchase-order.dto';

/**
 * `/api/organization/purchase-orders` — purchase orders org-native.
 *
 * Lecturas: consolidadas por org (con `?store_id` opcional como breakdown).
 * Mutaciones: delegan al `PurchaseOrdersService` store-side dentro de un
 * `runWithStoreContext(store_id)` resuelto a partir de `location_id` (o de
 * la OC existente). El flujo conserva audit, eventos, costing y el
 * StockLevelManager existentes sin duplicar lógica.
 *
 * Permisos: reusa `store:orders:purchase_orders:*` (matriz Fase 2 — la
 * división por dominio se garantiza por `DomainScopeGuard` con el claim
 * `app_type` del JWT, no por las claves de permiso).
 */
@Controller('organization/purchase-orders')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgPurchaseOrdersController {
  constructor(
    private readonly purchaseOrders: OrgPurchaseOrdersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('stats')
  @Permissions('store:orders:purchase_orders:read')
  async getStats() {
    const data = await this.purchaseOrders.getStats();
    return this.responseService.success(
      data,
      'Estadísticas de órdenes de compra obtenidas',
    );
  }

  @Get()
  @Permissions('store:orders:purchase_orders:read')
  async findAll(@Query() query: OrgPurchaseOrderQueryDto) {
    const result = await this.purchaseOrders.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Órdenes de compra obtenidas exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:orders:purchase_orders:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.purchaseOrders.findOne(id);
    return this.responseService.success(
      data,
      'Orden de compra obtenida exitosamente',
    );
  }

  @Post()
  @Permissions('store:orders:purchase_orders:create')
  async create(@Body() dto: CreateOrgPurchaseOrderDto) {
    const data = await this.purchaseOrders.create(dto);
    return this.responseService.created(
      data,
      'Orden de compra creada exitosamente',
    );
  }

  @Patch(':id/approve')
  @Permissions('store:orders:purchase_orders:approve')
  async approve(@Param('id', ParseIntPipe) id: number) {
    const data = await this.purchaseOrders.approve(id);
    return this.responseService.success(
      data,
      'Orden de compra aprobada exitosamente',
    );
  }

  @Patch(':id/cancel')
  @Permissions('store:orders:purchase_orders:cancel')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    const data = await this.purchaseOrders.cancel(id);
    return this.responseService.success(
      data,
      'Orden de compra cancelada exitosamente',
    );
  }

  @Post(':id/receive')
  @Permissions('store:orders:purchase_orders:receive')
  async receive(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
    const data = await this.purchaseOrders.receive(id, dto);
    return this.responseService.success(
      data,
      'Orden de compra recibida exitosamente',
    );
  }
}
