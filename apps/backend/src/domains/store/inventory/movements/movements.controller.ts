import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { MovementsService } from './movements.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';
import { ResponseService } from '@common/responses/response.service';

/**
 * Sin try/catch por handler a propósito: `responseService.error()` RETORNA el
 * sobre en lugar de lanzarlo, así que un fallo salía con HTTP 200 y
 * `success: false`. En el listado de movimientos eso significaba pintar "sin
 * movimientos" cuando en realidad la consulta falló. La excepción tiene que
 * llegar a `AllExceptionsFilter` para que el status y el código sean reales.
 */
@Controller('store/inventory/movements')
@UseGuards(PermissionsGuard)
export class MovementsController {
  constructor(
    private readonly movementsService: MovementsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:inventory:movements:create')
  async create(@Body() createMovementDto: CreateMovementDto) {
    const result = await this.movementsService.create(createMovementDto);
    return this.responseService.created(
      result,
      'Movimiento de inventario creado exitosamente',
    );
  }

  @Get()
  @Permissions('store:inventory:movements:read')
  async findAll(@Query() query: MovementQueryDto) {
    const result = await this.movementsService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Movimientos de inventario obtenidos exitosamente',
    );
  }

  /**
   * Antes de `@Get(':id')` a propósito: Nest resuelve por orden de declaración,
   * así que declarada después, `stats` entraría por el comodín y se leería como
   * el id "stats".
   */
  @Get('stats')
  @Permissions('store:inventory:movements:read')
  async getStats(@Query() query: MovementQueryDto) {
    const result = await this.movementsService.getStats(query);
    return this.responseService.success(
      result,
      'Estadísticas de movimientos obtenidas exitosamente',
    );
  }

  @Get('product/:productId')
  @Permissions('store:inventory:movements:read')
  async findByProduct(
    @Param('productId') productId: string,
    @Query() query: MovementQueryDto,
  ) {
    const result = await this.movementsService.findByProduct(+productId, query);
    return this.responseService.success(
      result,
      'Movimientos del producto obtenidos exitosamente',
    );
  }

  @Get('location/:locationId')
  @Permissions('store:inventory:movements:read')
  async findByLocation(
    @Param('locationId') locationId: string,
    @Query() query: MovementQueryDto,
  ) {
    const result = await this.movementsService.findByLocation(
      +locationId,
      query,
    );
    return this.responseService.success(
      result,
      'Movimientos de la ubicación obtenidos exitosamente',
    );
  }

  @Get('user/:userId')
  @Permissions('store:inventory:movements:read')
  async findByUser(
    @Param('userId') userId: string,
    @Query() query: MovementQueryDto,
  ) {
    const result = await this.movementsService.findByUser(+userId, query);
    return this.responseService.success(
      result,
      'Movimientos del usuario obtenidos exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:inventory:movements:read')
  async findOne(@Param('id') id: string) {
    const result = await this.movementsService.findOne(+id);
    return this.responseService.success(
      result,
      'Movimiento de inventario obtenido exitosamente',
    );
  }
}
