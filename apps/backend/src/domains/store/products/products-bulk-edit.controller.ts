import { Controller, Post, Body, UseGuards, Logger, Req } from '@nestjs/common';
import { ProductsBulkEditService } from './products-bulk-edit.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { BulkArchiveProductsDto, BulkEditProductsDto } from './dto';
import { ApiOperation } from '@nestjs/swagger';

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
   * Exige el permiso requerido POR NOMBRE, además del `PermissionsGuard`.
   *
   * `PermissionsGuard` resuelve con OR entre el match por nombre y el match por
   * ruta, y el match por ruta es un `startsWith` (`permissions.guard.ts:48-57`).
   * Como `store:products:create` está sembrado con `path:
   * '/api/store/products'` + `POST`, ese prefijo cubre CUALQUIER POST anidado
   * bajo productos — incluidos `/bulk-edit`, `/bulk-edit/preview` y
   * `/bulk-edit/archive`. Sin este refuerzo, quien solo pueda crear un producto
   * pasaría el guard para editar o archivar 100, y la separación de permisos que
   * justifica `store:products:bulk_update` y `store:products:admin_delete`
   * quedaría decorativa.
   *
   * Estrechar el match por ruta arreglaría la causa raíz, pero `PermissionsGuard`
   * es código compartido por todos los dominios y cambiarlo aquí tendría un radio
   * de impacto que este ticket no puede verificar. El guard sigue siendo la
   * primera línea; esto cierra el agujero localmente para las cuatro rutas de
   * este controller.
   *
   * Replica el bypass de super_admin del guard (`permissions.guard.ts:35-37`)
   * para no volverse más estricto que él en ese caso.
   */
  private assertNamedPermission(request: any, required: string): void {
    const roles: string[] = request?.user?.roles ?? [];
    if (roles.includes(UserRole.SUPER_ADMIN)) return;

    const granted: Array<{ name?: string; status?: string }> =
      request?.user?.permissions ?? [];
    const hasIt = granted.some(
      (perm) => perm?.name === required && perm?.status === 'active',
    );

    if (!hasIt) {
      this.logger.warn(
        `Bloqueado por refuerzo de permiso: falta '${required}' (user=${request?.user?.id ?? 'desconocido'})`,
      );
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }
  }

  /**
   * Dry-run: calcula el diff por producto sin escribir nada.
   *
   * Es POST y no GET porque el cuerpo lleva la selección de ids y el objeto de
   * cambios propuestos, que no caben razonablemente en query params.
   */
  @ApiOperation({
    summary:
      'Mostrar qué cambiaría en cada producto de la selección antes de aplicar una edición masiva',
  })
  @Post('preview')
  @Permissions('store:products:bulk_update')
  async preview(@Body() dto: BulkEditProductsDto, @Req() request: any) {
    this.assertNamedPermission(request, 'store:products:bulk_update');
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
  @ApiOperation({
    summary:
      'Aplicar una edición masiva sobre varios productos a la vez: precios, costos, impuestos, categorías, marca, banderas de venta y presentaciones habilitadas',
  })
  @Post()
  @Permissions('store:products:bulk_update')
  async apply(@Body() dto: BulkEditProductsDto, @Req() request: any) {
    this.assertNamedPermission(request, 'store:products:bulk_update');
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

  // ===========================================================================
  // Archivado masivo (soft-delete)
  // ===========================================================================
  //
  // Permiso `store:products:admin_delete`, NO `store:products:bulk_update`:
  // eliminar N productos es una acción distinta de editarles un campo y no debe
  // compartir permiso con `is_featured`.
  //
  // Y es `admin_delete`, no `delete`: el archivado individual
  // (`DELETE /store/products/:id`, `products.controller.ts:314-315`) exige
  // `admin_delete`, mientras que `store:products:delete` solo protege
  // `PATCH :id/deactivate`, que deja el producto en `inactive` y es reversible.
  // Archivar 100 productos no puede pedir menos permiso que archivar uno.
  //
  // IRREVERSIBILIDAD (decisión de negocio, QUI-567): no existe ninguna ruta de
  // API que desarchive un producto. `update()` y `deactivate()` filtran
  // `state != archived` (`products.service.ts:1903-1907`, `:2761-2765`) y el
  // controller no tiene `activate`/`restore`. Un archivado masivo erróneo solo se
  // revierte con acceso directo a la base. Se entrega así de forma consciente; el
  // preview y la confirmación reforzada son la única red.
  //
  // El permiso ya existe en el seed y `PermissionsGuard` lo resuelve por NOMBRE
  // (`permissions.guard.ts:59-65`), así que no hace falta fila nueva con
  // `path`/`method` de estas rutas. El refuerzo por nombre de
  // `assertNamedPermission()` es lo que impide que el `startsWith` del guard deje
  // entrar a quien solo tenga `create` o `bulk_update`.

  /**
   * Dry-run del archivado: clasifica cada producto (bloqueos y avisos) sin
   * escribir nada. Es la antesala obligatoria de la confirmación reforzada.
   */
  @ApiOperation({
    summary:
      'Mostrar qué productos se archivarían y cuáles no antes de archivar en lote',
  })
  @Post('archive/preview')
  @Permissions('store:products:admin_delete')
  async previewArchive(@Body() dto: BulkArchiveProductsDto, @Req() request: any) {
    this.assertNamedPermission(request, 'store:products:admin_delete');
    try {
      const result = await this.productsBulkEditService.previewArchive(dto);
      return this.responseService.success(
        result,
        'Previsualización de archivado masivo generada exitosamente',
      );
    } catch (error) {
      // Conserva status + error_code + details de las excepciones tipadas.
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al previsualizar el archivado masivo',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /**
   * Archiva el lote (soft-delete: `state = 'archived'`). Igual que `apply()`, es
   * parcialmente tolerante a fallos: `failed > 0` sigue siendo 200.
   *
   * No existe contraparte de restauración, ni masiva ni individual: ver la nota de
   * IRREVERSIBILIDAD arriba.
   */
  @ApiOperation({
    summary:
      'Archivar varios productos a la vez',
  })
  @Post('archive')
  @Permissions('store:products:admin_delete')
  async archive(@Body() dto: BulkArchiveProductsDto, @Req() request: any) {
    this.assertNamedPermission(request, 'store:products:admin_delete');
    try {
      const result = await this.productsBulkEditService.archive(dto);

      if (result.failed > 0) {
        return this.responseService.updated(
          result,
          'Archivado masivo completado con algunos errores',
        );
      }

      return this.responseService.updated(
        result,
        'Archivado masivo completado exitosamente',
      );
    } catch (error) {
      this.logger.error(
        `Bulk archive failed (ids=${dto?.ids?.length ?? 0}): ${error?.message || error}`,
        error?.stack,
      );
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al aplicar el archivado masivo',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
