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
import { ApiOperation } from '@nestjs/swagger';

/**
 * Store-scoped CRUD for multi-tarifa (price tiers).
 *
 * Marked as @SkipSubscriptionGate because configuring price tiers is base
 * store configuration (just like categories/brands). Actually applying a
 * tier inside POS/orders is enforced separately via the
 * `store:products:apply_pricing_tier` permission in OrdersService.
 *
 * Los handlers NO envuelven en try/catch. Lo hacían, y cada `catch` llamaba
 * `responseService.error(...)`, que **devuelve** un cuerpo `success:false` en
 * vez de lanzar: toda rechazo salía con HTTP 200. El consumidor web
 * (`price-tiers.service.ts`) mapea `res => res.data`, así que un 200 con
 * `data` ausente resolvía el observable como éxito y el editor decía "Override
 * guardado" sobre una escritura rechazada — exactamente el falso positivo que
 * la regla multi-tarifa ⊕ variantes necesita evitar. Sin el catch, la
 * VendixHttpException llega al filtro global con su status real (409 acá) y el
 * cliente falla como debe.
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

  @ApiOperation({
    summary:
      'Crear una tarifa de la tienda: una presentación de venta (bulto, caja, rollo) cuando kind es sale_unit, o un nivel de precio por tipo de cliente cuando kind es customer_tier',
  })
  @Post()
  @Permissions('store:price-tiers:create')
  async create(@Body() dto: CreatePriceTierDto) {
    const result = await this.priceTiersService.create(dto);
    return this.responseService.created(
      result,
      'Tarifa de precios creada exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Listar las tarifas de la tienda: presentaciones de venta y niveles de precio por cliente',
  })
  @Get()
  @Permissions('store:price-tiers:read')
  async findAll(@Query() query: PriceTierQueryDto) {
    const result = await this.priceTiersService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Tarifas obtenidas exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Ver el detalle de una tarifa',
  })
  @Get(':id')
  @Permissions('store:price-tiers:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.priceTiersService.findOne(id);
    return this.responseService.success(result, 'Tarifa obtenida exitosamente');
  }

  @ApiOperation({
    summary:
      'Editar una tarifa: nombre, código, descuento, unidades por paquete u orden de aparición',
  })
  @Patch(':id')
  @Permissions('store:price-tiers:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePriceTierDto,
  ) {
    const result = await this.priceTiersService.update(id, dto);
    return this.responseService.updated(
      result,
      'Tarifa actualizada exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Desactivar una tarifa. Los productos que la tenían habilitada dejan de venderse en ella',
  })
  @Delete(':id')
  @Permissions('store:price-tiers:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.priceTiersService.softDelete(id);
    return this.responseService.deleted('Tarifa desactivada exitosamente');
  }

  @ApiOperation({
    summary:
      'Reactivar una tarifa desactivada',
  })
  @Post(':id/restore')
  @Permissions('store:price-tiers:update')
  async restore(@Param('id', ParseIntPipe) id: number) {
    const result = await this.priceTiersService.restore(id);
    return this.responseService.updated(
      result,
      'Tarifa restaurada exitosamente',
    );
  }

  // --------------------------------------------- Overrides por producto

  @ApiOperation({
    summary:
      'Ver qué precio, empaque, margen y código de barras tiene un producto en cada una de sus presentaciones',
  })
  @Get('products/:productId/overrides')
  @Permissions('store:price-tiers:read')
  async listProductOverrides(
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    const result =
      await this.priceTiersService.findOverridesByProduct(productId);
    return this.responseService.success(
      result,
      'Overrides obtenidos exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Fijar para un producto el precio, las unidades por paquete, el margen, el código de barras o la presentación por defecto de una tarifa concreta. El precio es el del PAQUETE ENTERO. La tarifa ya tiene que estar habilitada en el producto',
  })
  @Put('products/:productId/overrides/:tierId')
  @Permissions('store:price-tiers:update')
  async upsertProductOverride(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('tierId', ParseIntPipe) tierId: number,
    @Body() dto: UpsertProductPriceTierOverrideDto,
  ) {
    const result = await this.priceTiersService.upsertProductOverride(
      productId,
      tierId,
      dto,
    );
    return this.responseService.updated(
      result,
      'Override guardado exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Quitar el precio propio que un producto tenía en una tarifa y volver a la regla general de esa tarifa',
  })
  @Delete('products/:productId/overrides/:tierId')
  @Permissions('store:price-tiers:update')
  async removeProductOverride(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('tierId', ParseIntPipe) tierId: number,
    @Query('variant_id') variantId?: string,
  ) {
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
  }
}
