import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { CouponsService } from './coupons.service';
import {
  CreateCouponDto,
  UpdateCouponDto,
  CouponQueryDto,
  ValidateCouponDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/coupons')
@UseGuards(PermissionsGuard)
export class CouponsController {
  constructor(
    private readonly couponsService: CouponsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:coupons:create')
  async create(@Body() dto: CreateCouponDto) {
    try {
      const result = await this.couponsService.create(dto);
      return this.responseService.created(result, 'Cupón creado exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear el cupón',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @Permissions('store:coupons:read')
  async findAll(@Query() query: CouponQueryDto) {
    try {
      const result = await this.couponsService.findAll(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Cupones obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los cupones',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('stats')
  @Permissions('store:coupons:read')
  async getStats() {
    try {
      const result = await this.couponsService.getStats();
      return this.responseService.success(
        result,
        'Stats obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener stats',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('validate')
  @Permissions('store:coupons:validate')
  async validate(@Body() dto: ValidateCouponDto) {
    try {
      const result = await this.couponsService.validate(dto);
      return this.responseService.success(
        result,
        'Cupón validado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al validar el cupón',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:coupons:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.couponsService.findOne(id);
      return this.responseService.success(
        result,
        'Cupón obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el cupón',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:coupons:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCouponDto,
  ) {
    try {
      const result = await this.couponsService.update(id, dto);
      return this.responseService.updated(
        result,
        'Cupón actualizado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar el cupón',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:coupons:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.couponsService.remove(id);
      return this.responseService.deleted('Cupón eliminado exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar el cupón',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
