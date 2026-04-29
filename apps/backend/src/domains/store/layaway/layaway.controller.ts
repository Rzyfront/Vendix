import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { LayawayService } from './layaway.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import {
  CreateLayawayDto,
  LayawayQueryDto,
  MakeLayawayPaymentDto,
  ModifyInstallmentsDto,
  CancelLayawayDto,
} from './dto';

@Controller('store/layaway')
@UseGuards(PermissionsGuard)
export class LayawayController {
  constructor(
    private readonly layaway_service: LayawayService,
    private readonly response_service: ResponseService,
  ) {}

  @Post()
  @Permissions('store:layaway:create')
  async create(@Body() dto: CreateLayawayDto) {
    try {
      const result = await this.layaway_service.create(dto);
      return this.response_service.created(
        result,
        'Plan separé creado exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        error.message || 'Error al crear el plan separé',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @Permissions('store:layaway:read')
  async findAll(@Query() query: LayawayQueryDto) {
    try {
      const result = await this.layaway_service.findAll(query);
      return this.response_service.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
      );
    } catch (error) {
      return this.response_service.error(
        error.message || 'Error al listar planes separé',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('stats')
  @Permissions('store:layaway:read')
  async getStats() {
    try {
      const result = await this.layaway_service.getStats();
      return this.response_service.success(result);
    } catch (error) {
      return this.response_service.error(
        error.message || 'Error al obtener estadísticas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:layaway:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.layaway_service.findOne(id);
      return this.response_service.success(result);
    } catch (error) {
      return this.response_service.error(
        error.message || 'Error al obtener plan separé',
        error.response?.message || error.message,
        error.status || 404,
      );
    }
  }

  @Post(':id/payment')
  @Permissions('store:layaway:create')
  async makePayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MakeLayawayPaymentDto,
  ) {
    try {
      const result = await this.layaway_service.makePayment(id, dto);
      return this.response_service.success(
        result,
        'Pago registrado exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        error.message || 'Error al registrar pago',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/installments')
  @Permissions('store:layaway:update')
  async modifyInstallments(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ModifyInstallmentsDto,
  ) {
    try {
      const result = await this.layaway_service.modifyInstallments(id, dto);
      return this.response_service.success(
        result,
        'Cuotas modificadas exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        error.message || 'Error al modificar cuotas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/cancel')
  @Permissions('store:layaway:update')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelLayawayDto,
  ) {
    try {
      const result = await this.layaway_service.cancel(id, dto);
      return this.response_service.success(result, 'Plan separé cancelado');
    } catch (error) {
      return this.response_service.error(
        error.message || 'Error al cancelar plan separé',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/complete')
  @Permissions('store:layaway:update')
  async complete(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.layaway_service.complete(id);
      return this.response_service.success(result, 'Plan separé completado');
    } catch (error) {
      return this.response_service.error(
        error.message || 'Error al completar plan separé',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
