import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { ResponseService } from '../../../common/responses/response.service';

@Controller('orders/purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  async create(@Body() createPurchaseOrderDto: CreatePurchaseOrderDto) {
    try {
      const result = await this.purchaseOrdersService.create(
        createPurchaseOrderDto,
      );
      return this.responseService.created(
        result,
        'Orden de compra creada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  async findAll(@Query() query: PurchaseOrderQueryDto) {
    try {
      const result = await this.purchaseOrdersService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Órdenes de compra obtenidas exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Órdenes de compra obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('draft')
  async findDrafts(@Query() query: PurchaseOrderQueryDto) {
    try {
      const result = await this.purchaseOrdersService.findByStatus(
        'draft',
        query,
      );
      return this.responseService.success(
        result,
        'Borradores de órdenes de compra obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los borradores de órdenes de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('approved')
  async findApproved(@Query() query: PurchaseOrderQueryDto) {
    try {
      const result = await this.purchaseOrdersService.findByStatus(
        'approved',
        query,
      );
      return this.responseService.success(
        result,
        'Órdenes de compra aprobadas obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes de compra aprobadas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('pending')
  async findPending(@Query() query: PurchaseOrderQueryDto) {
    try {
      const result = await this.purchaseOrdersService.findPending(query);
      return this.responseService.success(
        result,
        'Órdenes de compra pendientes obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes de compra pendientes',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('supplier/:supplierId')
  async findBySupplier(
    @Param('supplierId') supplierId: string,
    @Query() query: PurchaseOrderQueryDto,
  ) {
    try {
      const result = await this.purchaseOrdersService.findBySupplier(
        +supplierId,
        query,
      );
      return this.responseService.success(
        result,
        'Órdenes de compra del proveedor obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes de compra del proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.findOne(+id);
      return this.responseService.success(
        result,
        'Orden de compra obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updatePurchaseOrderDto: UpdatePurchaseOrderDto,
  ) {
    try {
      const result = await this.purchaseOrdersService.update(
        +id,
        updatePurchaseOrderDto,
      );
      return this.responseService.updated(
        result,
        'Orden de compra actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.approve(+id);
      return this.responseService.success(
        result,
        'Orden de compra aprobada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al aprobar la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/cancel')
  async cancel(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.cancel(+id);
      return this.responseService.success(
        result,
        'Orden de compra cancelada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al cancelar la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/receive')
  async receive(
    @Param('id') id: string,
    @Body()
    receiveData: { items: Array<{ id: number; quantity_received: number }> },
  ) {
    try {
      const result = await this.purchaseOrdersService.receive(
        +id,
        receiveData.items,
      );
      return this.responseService.success(
        result,
        'Orden de compra recibida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al recibir la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.purchaseOrdersService.remove(+id);
      return this.responseService.deleted(
        'Orden de compra eliminada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
