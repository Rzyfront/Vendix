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

/**
 * No handler here has a `try/catch`, and none must get one back (QUI-893).
 * Returning `response_service.error(...)` from a catch answered 200/201 with
 * `success:false`, so the UI showed "Plan cancelado" for a cancellation the
 * backend had blocked. `LayawayService` throws `VendixHttpException`; the global
 * `AllExceptionsFilter` emits the real status and `error_code`.
 * Contract pinned by `layaway.http-contract.spec.ts`.
 */
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
    const result = await this.layaway_service.create(dto);
    return this.response_service.created(
      result,
      'Plan separé creado exitosamente',
    );
  }

  @Get()
  @Permissions('store:layaway:read')
  async findAll(@Query() query: LayawayQueryDto) {
    const result = await this.layaway_service.findAll(query);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Get('stats')
  @Permissions('store:layaway:read')
  async getStats() {
    const result = await this.layaway_service.getStats();
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('store:layaway:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.layaway_service.findOne(id);
    return this.response_service.success(result);
  }

  @Post(':id/payment')
  @Permissions('store:layaway:create')
  async makePayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MakeLayawayPaymentDto,
  ) {
    const result = await this.layaway_service.makePayment(id, dto);
    return this.response_service.success(result, 'Pago registrado exitosamente');
  }

  @Patch(':id/installments')
  @Permissions('store:layaway:update')
  async modifyInstallments(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ModifyInstallmentsDto,
  ) {
    const result = await this.layaway_service.modifyInstallments(id, dto);
    return this.response_service.success(
      result,
      'Cuotas modificadas exitosamente',
    );
  }

  @Post(':id/cancel')
  @Permissions('store:layaway:update')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelLayawayDto,
  ) {
    const result = await this.layaway_service.cancel(id, dto);
    return this.response_service.success(result, 'Plan separé cancelado');
  }

  @Post(':id/complete')
  @Permissions('store:layaway:update')
  async complete(@Param('id', ParseIntPipe) id: number) {
    const result = await this.layaway_service.complete(id);
    return this.response_service.success(result, 'Plan separé completado');
  }
}
