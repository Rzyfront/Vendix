import { Controller, Get, Param, Query } from '@nestjs/common';
import { StockLevelsService } from './stock-levels.service';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';
import { ResponseService } from '@common/responses/response.service';
import { InventoryBatchesService } from '../batches/inventory-batches.service';

@Controller('store/inventory/stock-levels')
export class StockLevelsController {
  constructor(
    private readonly stockLevelsService: StockLevelsService,
    private readonly responseService: ResponseService,
    private readonly batchesService: InventoryBatchesService,
  ) {}

  @Get()
  async findAll(@Query() query: StockLevelQueryDto) {
    try {
      const result = await this.stockLevelsService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Niveles de stock obtenidos exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Niveles de stock obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los niveles de stock',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('product/:productId')
  async findByProduct(
    @Param('productId') productId: string,
    @Query() query: StockLevelQueryDto,
  ) {
    try {
      const result = await this.stockLevelsService.findByProduct(
        +productId,
        query,
      );
      return this.responseService.success(
        result,
        'Niveles de stock del producto obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los niveles de stock del producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('product/:productId/batches')
  async findBatchesByProduct(
    @Param('productId') productId: string,
    @Query('location_id') locationId?: string,
  ) {
    try {
      const result = await this.batchesService.getBatches({
        productId: +productId,
        locationId: locationId ? +locationId : undefined,
      });
      return this.responseService.success(
        result.batches || [],
        'Lotes del producto obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los lotes del producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('location/:locationId')
  async findByLocation(
    @Param('locationId') locationId: string,
    @Query() query: StockLevelQueryDto,
  ) {
    try {
      const result = await this.stockLevelsService.findByLocation(
        +locationId,
        query,
      );
      return this.responseService.success(
        result,
        'Niveles de stock de la ubicación obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message ||
          'Error al obtener los niveles de stock de la ubicación',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('alerts')
  async getStockAlerts(@Query() query: StockLevelQueryDto) {
    try {
      const result = await this.stockLevelsService.getStockAlerts(query);
      return this.responseService.success(
        result,
        'Alertas de stock obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las alertas de stock',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const result = await this.stockLevelsService.findOne(+id);
      return this.responseService.success(
        result,
        'Nivel de stock obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el nivel de stock',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
