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
import { MovementsService } from './movements.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/inventory/movements')
export class MovementsController {
  constructor(
    private readonly movementsService: MovementsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  async create(@Body() createMovementDto: CreateMovementDto) {
    try {
      const result = await this.movementsService.create(createMovementDto);
      return this.responseService.created(
        result,
        'Movimiento de inventario creado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear el movimiento de inventario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  async findAll(@Query() query: MovementQueryDto) {
    try {
      const result = await this.movementsService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Movimientos de inventario obtenidos exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Movimientos de inventario obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los movimientos de inventario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('product/:productId')
  async findByProduct(
    @Param('productId') productId: string,
    @Query() query: MovementQueryDto,
  ) {
    try {
      const result = await this.movementsService.findByProduct(
        +productId,
        query,
      );
      return this.responseService.success(
        result,
        'Movimientos del producto obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los movimientos del producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('location/:locationId')
  async findByLocation(
    @Param('locationId') locationId: string,
    @Query() query: MovementQueryDto,
  ) {
    try {
      const result = await this.movementsService.findByLocation(
        +locationId,
        query,
      );
      return this.responseService.success(
        result,
        'Movimientos de la ubicación obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los movimientos de la ubicación',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('user/:userId')
  async findByUser(
    @Param('userId') userId: string,
    @Query() query: MovementQueryDto,
  ) {
    try {
      const result = await this.movementsService.findByUser(+userId, query);
      return this.responseService.success(
        result,
        'Movimientos del usuario obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los movimientos del usuario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const result = await this.movementsService.findOne(+id);
      return this.responseService.success(
        result,
        'Movimiento de inventario obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el movimiento de inventario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
