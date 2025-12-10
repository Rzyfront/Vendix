import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { InventoryValidationService } from './services/inventory-validation.service';
import { ResponseService } from '@common/responses/response.service';
import { ValidateConsolidatedStockDto } from './dto/validate-consolidated-stock.dto';
import { ValidateMultipleConsolidatedStockDto } from './dto/validate-multiple-consolidated-stock.dto';

@Controller('store/inventory')
export class InventoryController {
  constructor(
    private readonly inventoryValidationService: InventoryValidationService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('validate-consolidated-stock')
  async validateConsolidatedStock(
    @Body() validateDto: ValidateConsolidatedStockDto,
  ) {
    try {
      const result =
        await this.inventoryValidationService.validateConsolidatedStock(
          validateDto,
        );
      return this.responseService.success(
        result,
        'Validación de stock consolidado completada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al validar stock consolidado',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('validate-multiple-consolidated-stock')
  async validateMultipleConsolidatedStock(
    @Body() validateDto: ValidateMultipleConsolidatedStockDto,
  ) {
    try {
      const result =
        await this.inventoryValidationService.validateMultipleConsolidatedStock(
          validateDto,
        );
      return this.responseService.success(
        result,
        'Validación de stock consolidado múltiple completada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al validar stock consolidado múltiple',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('consolidated-stock/product/:productId')
  async getConsolidatedStockByProduct(
    @Param('productId') productId: string,
    @Query('organization_id') organizationId?: number,
  ) {
    try {
      const result =
        await this.inventoryValidationService.getConsolidatedStockByProduct(
          +productId,
          organizationId ? +organizationId : undefined,
        );
      return this.responseService.success(
        result,
        'Stock consolidado del producto obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener stock consolidado del producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
