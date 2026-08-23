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
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { ProductVariantService } from './services/product-variant.service';
import {
  CreateProductDto,
  UpdateProductDto,
  CreateProductVariantDto,
  UpdateProductVariantDto,
  ProductImageDto,
  ProductQueryDto,
  GenerateProductDescriptionDto,
  GenerateProductImageEnhancementDto,
  UpdateProductPromotionsDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/products')
@UseGuards(PermissionsGuard)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly productVariantService: ProductVariantService,
    private readonly responseService: ResponseService,
  ) {}
  @ApiOperation({
    summary:
      'Redactar con IA la descripción comercial de un producto a partir de su nombre y sus datos',
  })
  @Post('generate-description')
  @Permissions('store:products:create')
  async generateDescription(@Body() dto: GenerateProductDescriptionDto) {
    // SIN try/catch (mismo contrato de error que `remove`/`createVariant` en este
    // archivo). Ver `vendix-error-handling/SKILL.md` — el `AllExceptionsFilter`
    // traduce `VendixHttpException` y los errores genéricos a su status real.
    const result = await this.productsService.generateDescription(dto);
    return this.responseService.success(
      result,
      'Descripción generada exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Mejorar con IA la foto de un producto',
  })
  @Post('enhance-image')
  @Permissions('store:products:create', 'store:products:update')
  async enhanceImage(@Body() dto: GenerateProductImageEnhancementDto) {
    const result = await this.productsService.enhanceImage(dto);
    return this.responseService.success(result, 'Imagen mejorada exitosamente');
  }

  @ApiOperation({
    summary:
      'Crear un producto: nombre, precios, costo, impuestos, categorías, marca, unidades de medida, stock inicial y variantes',
  })
  @Post()
  @Permissions('store:products:create')
  async create(
    @Body() createProductDto: CreateProductDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // SIN try/catch (mismo contrato de error que `remove`/`createVariant` en este
    // archivo). `responseService.error()` RETORNA el sobre en vez de lanzarlo,
    // así que atraparlo acá convertía cualquier rechazo (incluido un fallo de
    // Prisma) en HTTP 201 con `success:false` enterrado en el cuerpo — el
    // frontend celebraba un producto que nunca se persistió. Ver FB-09 +
    // `vendix-error-handling/SKILL.md`. Las excepciones tipadas (p.ej.
    // FISCAL_VAT_NOT_RESPONSIBLE_001) suben al `AllExceptionsFilter` que las
    // traduce a su status real (409/412/422/500) y `error_code`.
    const result = await this.productsService.create(createProductDto);
    return this.responseService.created(
      result,
      'Producto creado exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Listar los productos de la tienda con búsqueda, filtros y paginación',
  })
  @Get()
  @Permissions('store:products:read')
  async findAll(
    @Query() query: ProductQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // SIN try/catch — ver `create` más arriba para la justificación completa.
    const result = await this.productsService.findAll(query);
    if (result.data && result.meta) {
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Productos obtenidos exitosamente',
      );
    }
    return this.responseService.success(
      result,
      'Productos obtenidos exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Ver qué promociones tiene aplicadas un producto',
  })
  @Get(':id/promotions')
  @Permissions('store:products:read')
  async getProductPromotions(@Param('id', ParseIntPipe) id: number) {
    // SIN try/catch — ver `create` más arriba.
    const result = await this.productsService.getProductPromotions(id);
    return this.responseService.success(
      result,
      'Promociones del producto obtenidas exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Cambiar a qué promociones pertenece un producto',
  })
  @Patch(':id/promotions')
  @Permissions('store:products:update')
  async updateProductPromotions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductPromotionsDto,
  ) {
    // SIN try/catch — ver `create` más arriba.
    const result = await this.productsService.updateProductPromotions(
      id,
      dto.promotion_ids,
    );
    return this.responseService.success(
      result,
      'Promociones del producto actualizadas exitosamente',
    );
  }

  /**
   * GET /api/store/products/ids
   *
   * Materializa sólo los ids que satisfacen los mismos filtros del listado,
   * para habilitar "seleccionar todos los resultados del filtro" en la edición
   * masiva (QUI-567) sin traer productos completos.
   *
   * `total` es el conteo real sin tope y `capped` avisa cuando el conjunto real
   * excede `MAX_PRODUCT_IDS`, para que la UI lo diga en voz alta en lugar de
   * truncar en silencio.
   *
   * IMPORTANTE: debe declararse ANTES de `@Get(':id')` — Nest resuelve por
   * orden de declaración y `:id` capturaría `ids` como parámetro, haciendo
   * fallar el `ParseIntPipe` con un 400.
   */
  @ApiOperation({
    summary:
      'Listar solo los identificadores de los productos que cumplen un filtro, para operaciones masivas',
  })
  @Get('ids')
  @Permissions('store:products:read')
  async findIds(@Query() query: ProductQueryDto) {
    // SIN try/catch — ver `create` más arriba.
    const result = await this.productsService.findIds(query);
    return this.responseService.success(
      result,
      'IDs de productos obtenidos exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Ver el detalle completo de un producto: precios, impuestos, stock, variantes, imágenes y presentaciones de venta',
  })
  @Get(':id')
  @Permissions('store:products:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    // SIN try/catch — ver `create` más arriba.
    const result = await this.productsService.findOne(id);
    return this.responseService.success(
      result,
      'Producto obtenido exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Listar los productos de una tienda concreta',
  })
  @Get('store/:storeId')
  @Permissions('store:products:read')
  async findByStore(@Param('storeId', ParseIntPipe) storeId: number) {
    // SIN try/catch — ver `create` más arriba.
    const result = await this.productsService.getProductsByStore(storeId);
    return this.responseService.success(
      result,
      'Productos de la tienda obtenidos exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Buscar un producto por su slug dentro de una tienda',
  })
  @Get('slug/:slug/store/:storeId')
  @Permissions('store:products:read')
  async findBySlug(
    @Param('slug') slug: string,
    @Param('storeId', ParseIntPipe) storeId: number,
  ) {
    // SIN try/catch — ver `create` más arriba.
    const result = await this.productsService.findBySlug(storeId, slug);
    return this.responseService.success(
      result,
      'Producto obtenido exitosamente por slug',
    );
  }

  @ApiOperation({
    summary:
      'Editar un producto: nombre, descripción, precio, costo, margen, impuestos, categorías, marca, unidades de medida, presentaciones de venta habilitadas, stock por ubicación y variantes',
  })
  @Patch(':id')
  @Permissions('store:products:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    // SIN try/catch — ver `create` más arriba para la justificación completa.
    const result = await this.productsService.update(id, updateProductDto);
    return this.responseService.updated(
      result,
      'Producto actualizado exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Generar el enlace de compra directa del producto en la tienda en línea',
  })
  @Post(':id/online-purchase-link')
  @Permissions('store:products:update')
  async generateOnlinePurchaseLink(@Param('id', ParseIntPipe) id: number) {
    // SIN try/catch — ver `create` más arriba.
    const result = await this.productsService.generateOnlinePurchaseLink(id);
    return this.responseService.success(
      result,
      'Link y QR de compra online generados exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Desactivar un producto para que deje de venderse, sin borrarlo',
  })
  @Patch(':id/deactivate')
  @Permissions('store:products:delete')
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    // SIN try/catch — ver `create` más arriba.
    await this.productsService.deactivate(id);
    return this.responseService.success(
      null,
      'Producto desactivado exitosamente',
    );
  }

  /**
   * CP-PURCHASE-TRANSPARENCY D.4 / D.9 — vista previa del castigo de
   * inventario que precede al archivado. ESTRICTAMENTE DE SOLO LECTURA.
   *
   * Permiso `admin_delete` y no `read`: es el ensayo de una operación
   * irreversible, y enumera existencias y su valoración. Quien no puede
   * archivar no necesita saber cuánto se destruiría.
   */
  @ApiOperation({
    summary:
      'Ver qué existencias se darán de baja si se archiva el producto (no escribe nada)',
  })
  @Get(':id/archive-preview')
  @Permissions('store:products:admin_delete')
  async previewArchive(@Param('id', ParseIntPipe) id: number) {
    const plan = await this.productsService.previewArchiveWriteOff(id);
    return this.responseService.success(
      plan,
      'Vista previa del archivado calculada',
    );
  }

  /**
   * SIN try/catch, y es el arreglo (FB-09).
   *
   * `responseService.error()` RETORNA el sobre en vez de lanzarlo, así que el
   * `catch` que había aquí convertía CUALQUIER rechazo en un HTTP 200 con
   * `success:false` enterrado en el cuerpo. Con D.4 eso pasa de feo a
   * peligroso: un archivado rechazado por reservas activas, por existencias
   * fuera de alcance o por falta de confirmación se leería como éxito, y el
   * operador creería que borró el producto. El filtro global de excepciones ya
   * traduce `VendixHttpException` a su código y su estado.
   *
   * La confirmación viaja por query string porque `DELETE` no lleva cuerpo en
   * este contrato. El interceptor global de auditoría descarta el query string
   * (`audit.interceptor.ts:31`), pero eso da igual: `remove()` escribe su
   * propia fila con el token de confirmación dentro (D.8).
   */
  @ApiOperation({
    summary:
      'Archivar un producto definitivamente (da de baja sus existencias, previa confirmación)',
  })
  @Delete(':id')
  @Permissions('store:products:admin_delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Query('confirm_stock_write_off') confirmStockWriteOff?: string,
  ) {
    await this.productsService.remove(id, {
      confirm_stock_write_off: confirmStockWriteOff === 'true',
    });
    return this.responseService.deleted('Producto eliminado exitosamente');
  }
  // Product Variants endpoints
  @ApiOperation({
    summary:
      'Agregar una variante al producto (talla, color, sabor) con su propio precio y stock',
  })
  @Post(':id/variants')
  @Permissions('store:products:create')
  async createVariant(
    @Param('id', ParseIntPipe) productId: number,
    @Body() createVariantDto: CreateProductVariantDto,
  ) {
    // SIN try/catch, por la misma razón que `removeVariant` abajo:
    // `responseService.error()` RETORNA el sobre en vez de lanzarlo, así que
    // atraparlo acá convertía un rechazo en HTTP 201. Verificado en ejecución:
    // el bloqueo por «este producto es insumo de una receta» respondía
    // `HTTP 201` con `statusCode: 422` enterrado en el cuerpo, y el frontend
    // —que mira el status— celebraba una variante que nunca se creó.
    const result = await this.productVariantService.createVariant(
      productId,
      createVariantDto,
    );
    return this.responseService.created(
      result,
      'Variante de producto creada exitosamente',
    );
  }

  /**
   * PATCH /api/store/products/variants/:variantId
   *
   * Actualiza una variante individual (SKU, precio, stock, atributos, etc).
   *
   * IMPORTANTE: este endpoint NO acepta cambios de imagen. Los campos
   * `image_id` y `variant_image_url` del DTO son ignorados silenciosamente
   * — la gestión de la imagen de variante la hace exclusivamente el
   * orquestador de producto completo (`PATCH /products/:id`). Ver el
   * JSDoc de `ProductVariantService.updateVariant` para más detalle.
   */
  @ApiOperation({
    summary:
      'Editar una variante del producto',
  })
  @Patch('variants/:variantId')
  @Permissions('store:products:update')
  async updateVariant(
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() updateVariantDto: UpdateProductVariantDto,
  ) {
    // SIN try/catch: mismo contrato de error que `createVariant`/`removeVariant`.
    // Acá importa especialmente porque este handler es el que rechaza con
    // INV_STOCK_001 cuando la variante tiene existencias en varias bodegas; con
    // el catch, ese rechazo salía como 200 y el editor de producto daba por
    // guardado un ajuste de stock que el backend había frenado.
    const result = await this.productVariantService.updateVariant(
      variantId,
      updateVariantDto,
    );
    return this.responseService.updated(
      result,
      'Variante de producto actualizada exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Eliminar una variante del producto',
  })
  @Delete('variants/:variantId')
  @Permissions('store:products:delete')
  async removeVariant(@Param('variantId', ParseIntPipe) variantId: number) {
    // SIN try/catch a propósito. `responseService.error()` RETORNA el sobre en
    // vez de lanzarlo, así que atrapar acá convertía el bloqueo por existencias
    // en un HTTP 200 con `success:false`: el frontend —que sólo mira el status—
    // mostraba "variante eliminada" mientras el backend la había protegido.
    // Verificado en runtime: la guarda respondía 200 con el mensaje de bloqueo.
    // La excepción sube al AllExceptionsFilter, que traduce
    // PROD_VARIANT_HAS_STOCK_001 a su 409 con el código tipado.
    await this.productVariantService.removeVariant(variantId);
    return this.responseService.deleted(
      'Variante de producto eliminada exitosamente',
    );
  }

  // Product Images endpoints
  @ApiOperation({
    summary:
      'Agregar una imagen al producto',
  })
  @Post(':id/images')
  @Permissions('store:products:update')
  async addImage(
    @Param('id', ParseIntPipe) productId: number,
    @Body() imageDto: ProductImageDto,
  ) {
    // SIN try/catch — ver `create` más arriba.
    const result = await this.productsService.addImage(productId, imageDto);
    return this.responseService.created(
      result,
      'Imagen de producto agregada exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Quitar una imagen del producto',
  })
  @Delete('images/:imageId')
  @Permissions('store:products:update')
  async removeImage(@Param('imageId', ParseIntPipe) imageId: number) {
    // SIN try/catch — ver `create` más arriba.
    await this.productsService.removeImage(imageId);
    return this.responseService.deleted(
      'Imagen de producto eliminada exitosamente',
    );
  }

  @ApiOperation({
    summary:
      'Ver el resumen de productos de la tienda: totales, activos, sin stock y bajo mínimo',
  })
  @Get('stats/store/:storeId')
  @Permissions('store:products:read')
  async getProductStats(@Param('storeId', ParseIntPipe) storeId: number) {
    // SIN try/catch — ver `create` más arriba.
    const result = await this.productsService.getProductStats(storeId);
    return this.responseService.success(
      result,
      'Estadísticas de productos obtenidas exitosamente',
    );
  }
}
