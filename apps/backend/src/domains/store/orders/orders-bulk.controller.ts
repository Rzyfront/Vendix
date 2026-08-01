import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersBulkService } from './orders-bulk.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import {
  BulkAssignRouteDto,
  BulkPrintOrdersDto,
  BulkTransitionOrdersDto,
} from './dto/bulk-orders.dto';

/**
 * Operaciones masivas sobre órdenes (QUI-599).
 *
 * Controller dedicado con prefijo `store/orders/bulk` para no ensuciar
 * `OrdersController` ni chocar con su `@Get(':id')` — mismo motivo que llevó
 * a QUI-567 a crear `ProductsBulkEditController` separado.
 *
 * El tope de 300 ids lo impone el DTO (`@ArrayMaxSize`) a través del
 * `ValidationPipe` global; el controller no re-valida.
 *
 * Los tres endpoints son POST bajo `/api/store/`, por lo que quedan gateados
 * por `StoreOperationsGuard` (suscripción activa). No llevan
 * `@SkipSubscriptionGate()`: operar 100 órdenes es escritura de catálogo
 * + impresión, no debe seguir disponible cuando la tienda está bloqueada.
 */
@Controller('store/orders/bulk')
@UseGuards(PermissionsGuard)
export class OrdersBulkController {
  private readonly logger = new Logger(OrdersBulkController.name);

  constructor(
    private readonly ordersBulkService: OrdersBulkService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Exige el permiso requerido POR NOMBRE, además del `PermissionsGuard`.
   *
   * `PermissionsGuard` resuelve con OR entre el match por nombre y el match
   * por ruta, y el match por ruta es un `startsWith`
   * (`permissions.guard.ts:48-57`). Como `store:orders:update` está sembrado
   * con `path: '/api/store/orders/:id'` + `PATCH` y `store:orders:create` con
   * `path: '/api/store/orders'` + `POST`, este último cubre CUALQUIER POST
   * anidado bajo orders — incluidos `/bulk/transition`, `/bulk/assign-route`
   * y `/bulk/print`. Sin este refuerzo, quien solo pueda crear una orden
   * pasaría el guard para transicionar o imprimir 100, y la separación de
   * permisos que justifica `store:orders:bulk_update` y `store:orders:bulk_print`
   * quedaría decorativa.
   *
   * Replica el bypass de super_admin del guard (`permissions.guard.ts:35-37`)
   * para no volverse más estricto que él en ese caso. Calque exacto de
   * `products-bulk-edit.controller.ts:assertNamedPermission`.
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
   * Transiciona N órdenes al mismo estado destino (finalizar, enviar,
   * cancelar). Delega en `OrderFlowService.forceOrderState` por id, así que
   * cada orden ejecuta su cadena completa de efectos. Resultado parcialmente
   * tolerante a fallos: `failed > 0` sigue siendo HTTP 200.
   */
  @Post('transition')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:orders:bulk_update')
  async transition(
    @Body() dto: BulkTransitionOrdersDto,
    @Req() request: any,
  ) {
    this.assertNamedPermission(request, 'store:orders:bulk_update');
    try {
      const result = await this.ordersBulkService.bulkTransition(dto);

      if (result.failed > 0) {
        return this.responseService.updated(
          result,
          'Operación masiva completada con algunos errores',
        );
      }

      return this.responseService.updated(
        result,
        'Operación masiva completada exitosamente',
      );
    } catch (error) {
      this.logger.error(
        `Bulk transition failed (ids=${dto?.ids?.length ?? 0}): ${error?.message || error}`,
        error?.stack,
      );
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al aplicar la transición masiva',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /**
   * Dry-run de la transición masiva. NO escribe: devuelve por orden si se va a
   * aplicar (`ok`), si se aplicará forzando la máquina de estados (`warning`),
   * si se omite porque ya está en el estado destino (`skipped`) o por qué no se
   * puede (`error`). Es lo que alimenta el modal de pre-confirmación, de modo
   * que el operador ve el impacto ANTES de escribir.
   *
   * Va bajo el MISMO permiso que la escritura (`bulk_update`) y no bajo un
   * permiso de lectura: el preview enumera qué órdenes son vulnerables a una
   * transición masiva, que es información de la operación de escritura, no del
   * listado.
   */
  @Post('transition/preview')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:orders:bulk_update')
  async previewTransition(
    @Body() dto: BulkTransitionOrdersDto,
    @Req() request: any,
  ) {
    this.assertNamedPermission(request, 'store:orders:bulk_update');
    try {
      const result = await this.ordersBulkService.previewTransition(dto);
      return this.responseService.success(
        result,
        'Vista previa de la transición masiva',
      );
    } catch (error) {
      this.logger.error(
        `Bulk transition preview failed (ids=${dto?.ids?.length ?? 0}): ${error?.message || error}`,
        error?.stack,
      );
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al calcular la vista previa',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /**
   * Dry-run de la asignación a ruta. Replica las compuertas de
   * `DispatchNotesService.createFromOrder` sin crear nada, para que el modal
   * anticipe qué órdenes producirán remisión y cuáles no.
   */
  @Post('assign-route/preview')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:orders:bulk_update')
  async previewAssignRoute(
    @Body() dto: BulkAssignRouteDto,
    @Req() request: any,
  ) {
    this.assertNamedPermission(request, 'store:orders:bulk_update');
    try {
      const result = await this.ordersBulkService.previewAssignRoute(dto);
      return this.responseService.success(
        result,
        'Vista previa de la asignación a ruta',
      );
    } catch (error) {
      this.logger.error(
        `Bulk assign-route preview failed (ids=${dto?.ids?.length ?? 0}): ${error?.message || error}`,
        error?.stack,
      );
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al calcular la vista previa',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /**
   * Crea remisiones desde N órdenes y las asigna como stops a una planilla de
   * despacho en una sola operación. Reutiliza
   * `DispatchNotesService.createFromOrdersBatch` + `DispatchRoutesService.addStops`.
   * Resultado parcialmente tolerante a fallos.
   */
  @Post('assign-route')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:orders:bulk_update')
  async assignRoute(
    @Body() dto: BulkAssignRouteDto,
    @Req() request: any,
  ) {
    this.assertNamedPermission(request, 'store:orders:bulk_update');
    try {
      const result = await this.ordersBulkService.bulkAssignRoute(dto);

      if (result.failed > 0) {
        return this.responseService.updated(
          result,
          'Asignación a ruta completada con algunos errores',
        );
      }

      return this.responseService.updated(
        result,
        'Asignación a ruta completada exitosamente',
      );
    } catch (error) {
      this.logger.error(
        `Bulk assign-route failed (ids=${dto?.ids?.length ?? 0}): ${error?.message || error}`,
        error?.stack,
      );
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al asignar las órdenes a la ruta',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /**
   * Devuelve las órdenes imprimibles de la selección hidratadas con lo que el
   * tiquete POS lee, más el `pos_ticket_format` de la tienda. **No devuelve un
   * documento**: el render lo hace `PosTicketService` en el frontend, el mismo
   * servicio que dibuja el tiquete post-venta del POS y la previsualización de
   * Ajustes → Recibos, de modo que los tres flujos salen idénticos por
   * construcción.
   *
   * Contrato (`BulkPrintResultDto` dentro del envelope de `ResponseService`):
   * `{ total, printable, orders[], skipped[], pos_ticket_format }`, con
   * `printable + skipped.length === total`.
   *
   * El path y el permiso NO cambian: el row sembrado apunta a
   * `/api/store/orders/bulk/print` y renombrarlo lo dejaría muerto sin ganar
   * nada. La operación sigue siendo "imprimir en lote"; solo cambia dónde se
   * dibuja.
   *
   * Las omitidas van COMPLETAS en el body. Antes viajaban en
   * `X-Skipped-Orders` truncadas a 20 porque el body era binario y nginx corta
   * las cabeceras en 8 KB; en JSON esa restricción no existe.
   */
  @Post('print')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:orders:bulk_print')
  async print(@Body() dto: BulkPrintOrdersDto, @Req() request: any) {
    this.assertNamedPermission(request, 'store:orders:bulk_print');

    // Sin try/catch a propósito. `bulkPrint` lanza `VendixHttpException`
    // (`STORE_CONTEXT_001`, `ORD_BULK_PRINT_001`) y `AllExceptionsFilter` emite
    // el HTTP real con su `error_code`. Atraparlo para devolver
    // `responseService.error` produciría HTTP 200 con `success:false` y el
    // status verdadero enterrado en el body — el antipatrón que
    // `vendix-error-handling` prohíbe.
    const result = await this.ordersBulkService.bulkPrint(dto);

    return this.responseService.success(
      result,
      'Órdenes listas para imprimir',
    );
  }
}