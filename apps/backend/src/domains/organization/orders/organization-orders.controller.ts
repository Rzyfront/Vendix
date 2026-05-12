import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { OrganizationOrdersService } from './organization-orders.service';
import { OrganizationOrderQueryDto } from './dto/organization-order-query.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

/**
 * `/api/organization/orders/*` — read-only consolidated orders for ORG_ADMIN.
 *
 * IMPORTANTE: la creación/mutación de órdenes vive en `/api/store/orders/*`.
 * Este controller solo expone lecturas consolidadas org-wide (con breakdown
 * opcional por `?store_id=X`).
 *
 * Permisos: reutiliza la clave `store:orders:read` (paridad con
 * `/api/store/orders/*`) — en ORG_ADMIN cubre la lectura agregada.
 */
@Controller('organization/orders')
@UseGuards(PermissionsGuard)
export class OrganizationOrdersController {
  constructor(
    private readonly organizationOrdersService: OrganizationOrdersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:orders:read')
  async findAll(@Query() query: OrganizationOrderQueryDto) {
    try {
      const result = await this.organizationOrdersService.findAll(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Órdenes obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('recent')
  @Permissions('store:orders:read')
  async getRecent(
    @Query('limit') limit?: string,
    @Query('store_id') storeId?: string,
  ) {
    try {
      const parsedLimit = limit ? +limit : 5;
      const result = await this.organizationOrdersService.findRecent(
        parsedLimit,
        storeId,
      );
      return this.responseService.success(
        result,
        'Órdenes recientes obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener órdenes recientes',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('stats')
  @Permissions('store:orders:read')
  async getStats(
    @Query('store_id') storeId?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    try {
      const result = await this.organizationOrdersService.getStats(
        storeId,
        dateFrom,
        dateTo,
      );
      return this.responseService.success(
        result,
        'Estadísticas de órdenes obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener estadísticas de órdenes',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:orders:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.organizationOrdersService.findOne(id);
      if (!result) {
        return this.responseService.error(
          'Orden no encontrada',
          'Order not found',
          404,
        );
      }
      return this.responseService.success(
        result,
        'Orden obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id/invoice')
  @Permissions('store:orders:read')
  async getInvoice(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    try {
      const pdfBuffer =
        await this.organizationOrdersService.generateInvoicePdf(id);

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${id}.pdf"`,
        'Content-Length': pdfBuffer.length,
      });

      res.status(HttpStatus.OK).send(pdfBuffer);
    } catch (error) {
      if (error.message === 'Order not found') {
        return this.responseService.error(
          'Orden no encontrada',
          'Order not found',
          404,
        );
      }
      return this.responseService.error(
        error.message || 'Error al generar la factura',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
