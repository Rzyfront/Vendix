import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { StockLevelsService } from './stock-levels.service';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';
import { SourcingSuggestionQueryDto } from './dto/sourcing-suggestion-query.dto';
import { ResponseService } from '@common/responses/response.service';
import { InventoryBatchesService } from '../batches/inventory-batches.service';

/**
 * Sin try/catch por handler a propósito: `responseService.error()` RETORNA el
 * sobre en lugar de lanzarlo, así que un fallo salía con HTTP 200 y
 * `success: false`. En una lista eso es peor que un error: el frontend entraba
 * por el `next` con `data` vacío y pintaba "sin resultados" en vez de avisar.
 * La excepción tiene que llegar a `AllExceptionsFilter`.
 */
@Controller('store/inventory/stock-levels')
@UseGuards(PermissionsGuard)
export class StockLevelsController {
  constructor(
    private readonly stockLevelsService: StockLevelsService,
    private readonly responseService: ResponseService,
    private readonly batchesService: InventoryBatchesService,
  ) {}

  @Get()
  @Permissions('store:inventory:stock_levels:read')
  async findAll(@Query() query: StockLevelQueryDto) {
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
  }

  @Get('product/:productId')
  @Permissions('store:inventory:stock_levels:read')
  async findByProduct(
    @Param('productId') productId: string,
    @Query() query: StockLevelQueryDto,
  ) {
    const result = await this.stockLevelsService.findByProduct(
      +productId,
      query,
    );
    return this.responseService.success(
      result,
      'Niveles de stock del producto obtenidos exitosamente',
    );
  }

  @Get('product/:productId/batches')
  @Permissions('store:inventory:stock_levels:read')
  async findBatchesByProduct(
    @Param('productId') productId: string,
    @Query('location_id') locationId?: string,
  ) {
    const result = await this.batchesService.getBatches({
      productId: +productId,
      locationId: locationId ? +locationId : undefined,
    });
    return this.responseService.success(
      result.batches || [],
      'Lotes del producto obtenidos exitosamente',
    );
  }

  @Get('location/:locationId')
  @Permissions('store:inventory:stock_levels:read')
  async findByLocation(
    @Param('locationId') locationId: string,
    @Query() query: StockLevelQueryDto,
  ) {
    const result = await this.stockLevelsService.findByLocation(
      +locationId,
      query,
    );
    return this.responseService.success(
      result,
      'Niveles de stock de la ubicación obtenidos exitosamente',
    );
  }

  @Get('alerts')
  @Permissions('store:inventory:stock_levels:read')
  async getStockAlerts(@Query() query: StockLevelQueryDto) {
    const result = await this.stockLevelsService.getStockAlerts(query);
    return this.responseService.success(
      result,
      'Alertas de stock obtenidas exitosamente',
    );
  }

  @Get('sourcing-suggestion')
  @Permissions('store:inventory:stock_levels:read')
  async getSourcingSuggestion(@Query() query: SourcingSuggestionQueryDto) {
    const result = await this.stockLevelsService.getSourcingSuggestion(query);
    return this.responseService.success(
      result,
      'Sugerencia de sourcing obtenida exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:inventory:stock_levels:read')
  async findOne(@Param('id') id: string) {
    const result = await this.stockLevelsService.findOne(+id);
    return this.responseService.success(
      result,
      'Nivel de stock obtenido exitosamente',
    );
  }
}
