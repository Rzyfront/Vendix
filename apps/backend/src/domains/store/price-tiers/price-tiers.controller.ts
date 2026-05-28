import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PriceTiersService } from './price-tiers.service';
import {
  CreatePriceTierDto,
  UpdatePriceTierDto,
  PriceTierQueryDto,
  UpsertProductPriceTierOverrideDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { SkipSubscriptionGate } from '../subscriptions/decorators/skip-subscription-gate.decorator';

/**
 * Store-scoped CRUD for multi-tarifa (price tiers).
 *
 * Marked as @SkipSubscriptionGate because configuring price tiers is base
 * store configuration (just like categories/brands). Actually applying a
 * tier inside POS/orders is enforced separately via the
 * `store:products:apply_pricing_tier` permission in OrdersService.
 */
@Controller('store/price-tiers')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class PriceTiersController {
  constructor(
    private readonly priceTiersService: PriceTiersService,
    private readonly responseService: ResponseService,
  ) {}

  // ------------------------------------------------------- CRUD on tiers

  @Post()
  @Permissions('store:price-tiers:create')
  async create(@Body() dto: CreatePriceTierDto) {
    try {
      const result = await this.priceTiersService.create(dto);
      return this.responseService.created(
        result,
        'Tarifa de precios creada exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al crear la tarifa',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @Permissions('store:price-tiers:read')
  async findAll(@Query() query: PriceTierQueryDto) {
    try {
      const result = await this.priceTiersService.findAll(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Tarifas obtenidas exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener las tarifas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:price-tiers:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.priceTiersService.findOne(id);
      return this.responseService.success(
        result,
        'Tarifa obtenida exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener la tarifa',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:price-tiers:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePriceTierDto,
  ) {
    try {
      const result = await this.priceTiersService.update(id, dto);
      return this.responseService.updated(
        result,
        'Tarifa actualizada exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al actualizar la tarifa',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:price-tiers:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.priceTiersService.softDelete(id);
      return this.responseService.deleted('Tarifa desactivada exitosamente');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al desactivar la tarifa',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/restore')
  @Permissions('store:price-tiers:update')
  async restore(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.priceTiersService.restore(id);
      return this.responseService.updated(
        result,
        'Tarifa restaurada exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al restaurar la tarifa',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // --------------------------------------------- Overrides por producto

  @Get('products/:productId/overrides')
  @Permissions('store:price-tiers:read')
  async listProductOverrides(
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    try {
      const result =
        await this.priceTiersService.findOverridesByProduct(productId);
      return this.responseService.success(
        result,
        'Overrides obtenidos exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener los overrides',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Put('products/:productId/overrides/:tierId')
  @Permissions('store:price-tiers:update')
  async upsertProductOverride(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('tierId', ParseIntPipe) tierId: number,
    @Body() dto: UpsertProductPriceTierOverrideDto,
  ) {
    try {
      const result = await this.priceTiersService.upsertProductOverride(
        productId,
        tierId,
        dto,
      );
      return this.responseService.updated(
        result,
        'Override guardado exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al guardar el override',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete('products/:productId/overrides/:tierId')
  @Permissions('store:price-tiers:update')
  async removeProductOverride(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('tierId', ParseIntPipe) tierId: number,
    @Query('variant_id') variantId?: string,
  ) {
    try {
      const parsedVariantId =
        variantId !== undefined && variantId !== null && variantId !== ''
          ? Number(variantId)
          : undefined;
      const result = await this.priceTiersService.removeProductOverride(
        productId,
        tierId,
        parsedVariantId,
      );
      return this.responseService.success(
        result,
        'Override eliminado exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al eliminar el override',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
