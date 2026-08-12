import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { InventoryValidationService } from './services/inventory-validation.service';
import { ResponseService } from '@common/responses/response.service';
import { ValidateConsolidatedStockDto } from './dto/validate-consolidated-stock.dto';
import { ValidateMultipleConsolidatedStockDto } from './dto/validate-multiple-consolidated-stock.dto';

/**
 * Sin try/catch por handler a propósito.
 *
 * `responseService.error()` RETORNA el sobre en vez de lanzarlo: la respuesta
 * salía con HTTP 200 y `success: false` en el cuerpo, así que el frontend
 * entraba por el `next` del subscribe con datos vacíos en vez de por el
 * `error`. Dejar que la excepción suba hasta `AllExceptionsFilter` es lo que
 * produce el status real (404/409/422) y el código de error tipado.
 */
@Controller('store/inventory')
@UseGuards(PermissionsGuard)
export class InventoryController {
  constructor(
    private readonly inventoryValidationService: InventoryValidationService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('validate-consolidated-stock')
  @Permissions('store:inventory:inventory:create')
  async validateConsolidatedStock(
    @Body() validateDto: ValidateConsolidatedStockDto,
  ) {
    const result =
      await this.inventoryValidationService.validateConsolidatedStock(
        validateDto,
      );
    return this.responseService.success(
      result,
      'Validación de stock consolidado completada exitosamente',
    );
  }

  @Post('validate-multiple-consolidated-stock')
  @Permissions('store:inventory:inventory:create')
  async validateMultipleConsolidatedStock(
    @Body() validateDto: ValidateMultipleConsolidatedStockDto,
  ) {
    const result =
      await this.inventoryValidationService.validateMultipleConsolidatedStock(
        validateDto,
      );
    return this.responseService.success(
      result,
      'Validación de stock consolidado múltiple completada exitosamente',
    );
  }

  @Get('consolidated-stock/product/:productId')
  @Permissions('store:inventory:inventory:read')
  async getConsolidatedStockByProduct(
    @Param('productId') productId: string,
    @Query('organization_id') organizationId?: number,
  ) {
    const result =
      await this.inventoryValidationService.getConsolidatedStockByProduct(
        +productId,
        organizationId ? +organizationId : undefined,
      );
    return this.responseService.success(
      result,
      'Stock consolidado del producto obtenido exitosamente',
    );
  }
}
