import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { ProductsBulkEditService } from './products-bulk-edit.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException } from '@common/errors';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { BulkEditProductsDto } from './dto';

/**
 * Edición masiva de productos (QUI-567).
 *
 * Superficie HTTP hermana de `ProductsBulkController` (carga masiva) y
 * `ProductsBulkImageController` (imágenes masivas): controller propio con
 * prefijo anidado para no ensuchar `ProductsController` ni chocar con su
 * `@Get(':id')`.
 *
 * El tope de 100 ids lo impone `BulkEditProductsDto` (`@ArrayMaxSize`) a
 * través del `ValidationPipe` global — el controller no re-valida.
 *
 * Ambos endpoints son POST bajo `/api/store/`, por lo que quedan gateados por
 * `StoreOperationsGuard` (suscripción activa). Esto es intencional incluso en
 * `/preview`: el preview es la antesala obligatoria de una escritura de
 * catálogo y no debe seguir disponible cuando la tienda está bloqueada. No
 * lleva `@SkipSubscriptionGate()`.
 */
@Controller('store/products/bulk-edit')
@UseGuards(PermissionsGuard)
export class ProductsBulkEditController {
  private readonly logger = new Logger(ProductsBulkEditController.name);

  constructor(
    private readonly productsBulkEditService: ProductsBulkEditService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Dry-run: calcula el diff por producto sin escribir nada.
   *
   * Es POST y no GET porque el cuerpo lleva la selección de ids y el objeto de
   * cambios propuestos, que no caben razonablemente en query params.
   */
  @Post('preview')
  @Permissions('store:products:bulk_update')
  async preview(@Body() dto: BulkEditProductsDto) {
    try {
      const result = await this.productsBulkEditService.preview(dto);
      return this.responseService.success(
        result,
        'Previsualización de edición masiva generada exitosamente',
      );
    } catch (error) {
      // Conserva status + error_code + details de las excepciones tipadas.
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al previsualizar la edición masiva',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /**
   * Aplica los cambios. Devuelve el resultado por producto: la operación es
   * parcialmente tolerante a fallos, así que un `failed > 0` sigue siendo una
   * respuesta exitosa a nivel HTTP.
   */
  @Post()
  @Permissions('store:products:bulk_update')
  async apply(@Body() dto: BulkEditProductsDto) {
    try {
      const result = await this.productsBulkEditService.apply(dto);

      if (result.failed > 0) {
        return this.responseService.updated(
          result,
          'Edición masiva completada con algunos errores',
        );
      }

      return this.responseService.updated(
        result,
        'Edición masiva completada exitosamente',
      );
    } catch (error) {
      this.logger.error(
        `Bulk edit failed (ids=${dto?.ids?.length ?? 0}): ${error?.message || error}`,
        error?.stack,
      );
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al aplicar la edición masiva',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
