import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Sse,
  ForbiddenException,
  MessageEvent,
} from '@nestjs/common';
import { Observable, defer, from, interval, merge } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Request } from 'express';
import { Logger } from '@nestjs/common';
import { OrdersService } from './orders.service';
import {
  CreateOrderDto,
  UpdateOrderDto,
  OrderQueryDto,
  UpdateOrderItemsDto,
  UpdateOrderEditorDto,
} from './dto';
import { AssignShippingMethodDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException } from '@common/errors';
import { OrderEtaService } from './services/order-eta.service';
import { SettingsService } from '../settings/settings.service';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { EcommercePrismaService } from 'src/prisma/services/ecommerce-prisma.service';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PurchaseOrdersService } from './purchase-orders/purchase-orders.service';
import { PurchaseOrderQueryDto } from './purchase-orders/dto/purchase-order-query.dto';
import { ReturnOrdersService } from './return-orders/return-orders.service';
import { ReturnOrderQueryDto } from './return-orders/dto/return-order-query.dto';
// Carril B - B3: SSE compartido por tienda. El hub vive en
// NotificationsSseService (Map<store_id, Subject>). OrderSseService empuja
// eventos tipados al bus desde OrdersService via @OnEvent. Aqui suscribimos
// el stream y discriminamos por `payload.data.order_id` en el cliente.
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { RequestContextService } from '@common/context/request-context.service';

@Controller('store/orders')
@UseGuards(PermissionsGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly returnOrdersService: ReturnOrdersService,
    private readonly responseService: ResponseService,
    private readonly orderEtaService: OrderEtaService,
    private readonly settingsService: SettingsService,
    private readonly prisma: StorePrismaService,
    private readonly ecommercePrisma: EcommercePrismaService,
    // Carril B - B3: NotificationsSseService es el hub por store_id del que
    // OrderSseService empuja. Aqui suscribimos el stream del detalle de orden.
    private readonly sseService: NotificationsSseService,
  ) {}

  // CP-POS-SVC-PERF-001 / Bugfix — Nest can't reflect Logger as a
  // constructor parameter without `@Inject`. Initialize in the
  // class body so DI doesn't try to resolve it as the 9th dep.
  private readonly logger = new Logger(OrdersController.name);

  @Get()
  @Permissions('store:orders:read')
  async findAll(@Query() query: OrderQueryDto) {
    try {
      const result = await this.ordersService.findAll(query);
      return this.responseService.success(
        result,
        'Órdenes obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post()
  @Permissions('store:orders:create')
  async create(
    @Body() createOrderDto: CreateOrderDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.ordersService.create(createOrderDto, req.user);
      return this.responseService.created(result, 'Orden creada exitosamente');
    } catch (error) {
      // IVA cycle (F4): deja propagar las excepciones tipadas Vendix (p.ej.
      // FISCAL_VAT_NOT_RESPONSIBLE_001, context 'sale') al AllExceptionsFilter
      // para conservar 412 + error_code + details; el resto usa el legacy.
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al crear la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('stats')
  @Permissions('store:orders:read')
  async getStats() {
    try {
      const result = await this.ordersService.getStats();
      return this.responseService.success(
        result,
        'Estadísticas de órdenes obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener estadísticas de órdenes',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('preview-eta')
  @Permissions('store:orders:read')
  @ApiOperation({ summary: 'Preview estimated preparation and delivery time' })
  @ApiQuery({ name: 'cart_id', required: false, type: String })
  @ApiQuery({ name: 'shipping_method_id', required: false, type: String })
  async previewEta(
    @Query('cart_id') cartId?: string,
    @Query('shipping_method_id') shippingMethodId?: string,
  ) {
    try {
      let items: { preparation_time_minutes: number | null }[] = [];
      let transitMinutes = 0;

      if (cartId) {
        const cartItems = await this.ecommercePrisma.cart_items.findMany({
          where: { cart_id: +cartId },
          include: {
            product: { select: { preparation_time_minutes: true } },
          },
        });
        items = cartItems.map((ci: any) => ({
          preparation_time_minutes:
            ci.product?.preparation_time_minutes ?? null,
        }));
      }

      if (shippingMethodId) {
        const method = await this.prisma.shipping_methods.findUnique({
          where: { id: +shippingMethodId },
          select: { transit_time_minutes: true },
        });
        transitMinutes = method?.transit_time_minutes ?? 0;
      }

      const settings = await this.settingsService.getSettings();

      const eta = this.orderEtaService.computeEta(
        items,
        transitMinutes,
        (settings as any)?.operations,
        new Date(),
      );

      return this.responseService.success(eta, 'ETA preview calculated');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error computing ETA preview',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /**
   * Listado de devoluciones.
   *
   * `ReturnOrdersController` declara este mismo path con prefijo propio
   * (`store/orders/return-orders`), pero el `@Get(':id')` de abajo lo captura
   * antes —son las dos rutas de tres segmentos— y el `ParseIntPipe` respondía
   * 400 «numeric string is expected» a todo listado. Es el mismo choque que ya
   * resolvió `purchase-orders` justo debajo: la ruta estática se declara aquí,
   * delante de `:id`, y delega en el servicio del submódulo.
   *
   * Los demás endpoints de devoluciones no colisionan: todos tienen cuatro o
   * más segmentos.
   */
  @Get('return-orders')
  @Permissions('store:orders:return_orders:read')
  findReturnOrders(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findAll(query);
  }

  @Get('purchase-orders')
  @Permissions('store:orders:purchase_orders:read')
  async findPurchaseOrders(@Query() query: PurchaseOrderQueryDto) {
    try {
      const result = await this.purchaseOrdersService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Órdenes de compra obtenidas exitosamente',
        );
      }

      return this.responseService.success(
        result,
        'Órdenes de compra obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /**
   * Carril B - B3: SSE del detalle de orden. Colocado ARRIBA de `@Get(':id')`
   * por la misma razon que `@Get('return-orders')`, `@Get('purchase-orders')`,
   * etc. (ver comentario en :179): Nest resuelve rutas por orden de registro,
   * asi que `store/orders/stream` debe matchear antes que el `:id` parametrizado.
   *
   * - `@Req() req: Request` (no `@Query() DTO`): EventSource solo puede
   *   autenticarse por `?token=` (no header Authorization), y el
   *   ValidationPipe global con `forbidNonWhitelisted: true` rechazaria
   *   esa propiedad `token` con BadRequestException, que en SSE se emite
   *   como `event: error` y tumba el stream. Mismo motivo que kitchen-fire.
   * - Sin snapshot inicial: el cliente ya cargo la orden via
   *   `GET /store/orders/:id` antes de abrir el stream; aqui solo entran
   *   cambios en vivo. Cuando existan `order.paid` y el `order_id` del
   *   payload de mesa (encargados a lina), se filtran en cliente por
   *   `payload.data.order_id === idActual()`.
   */
  @Sse('stream')
  @Permissions('store:orders:read')
  stream(@Req() req: Request): Observable<MessageEvent> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new ForbiddenException('Store context required');
    }
    const store_id = context.store_id;

    const subject = this.sseService.getOrCreate(store_id);

    req.on('close', () => {
      this.sseService.unsubscribe(store_id);
    });

    // Live: cada push de OrderSseService llega al subject del store. El cliente
    // discrimina por `payload.data.order_id`.
    const live$ = subject.pipe(
      map(
        (payload) =>
          ({
            data: JSON.stringify(payload),
          }) as MessageEvent,
      ),
    );

    // Heartbeat 30s para que EventSource / proxies vean el stream vivo.
    const heartbeat$ = interval(30_000).pipe(
      map(
        () =>
          ({
            data: `: heartbeat ${Date.now()}`,
          }) as MessageEvent,
      ),
    );

    // `defer(() => from([]))` + `catchError` evitan que un fallo en el setup
    // tumbe el stream. Hoy no hay snapshot, pero la forma queda lista para
    // cuando el cliente quiera re-hidratar al reconectar.
    const snapshot$ = defer(() => from([] as MessageEvent[])).pipe(
      catchError(() => from([] as MessageEvent[])),
    );

    return merge(snapshot$, live$, heartbeat$);
  }

  @Get(':id')
  @Permissions('store:orders:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.ordersService.findOne(id);
      return this.responseService.success(
        result,
        'Orden obtenida exitosamente',
      );
    } catch (error) {
      // CP-POS-SVC-PERF-001 / Bugfix — never leak Prisma stack traces or
      // raw `Unknown field …` errors into the response body. VendixHttpException
      // errors carry a curated devMessage; everything else is an internal
      // server error and must surface as a generic 500 with a stable
      // error_code the frontend can switch on.
      if (error instanceof VendixHttpException) {
        return this.responseService.error(
          (error as any).devMessage || error.message,
          (error as any).userMessage || error.message,
          error.getStatus ? error.getStatus() : 400,
          (error as any).errorCode,
        );
      }
      // Unexpected — log the full trace server-side, return generic.
      this.logger.error(
        `[findOne:${id}] Unexpected error`,
        error?.stack || String(error),
      );
      return this.responseService.error(
        'No se pudo cargar la orden. Intenta de nuevo.',
        'INTERNAL_ORDER_LOAD_001',
        500,
        'INTERNAL_ORDER_LOAD_001',
      );
    }
  }

  @Get(':id/timeline')
  @Permissions('store:orders:read')
  async getTimeline(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.ordersService.getTimeline(id);
      return this.responseService.success(
        result,
        'Línea de tiempo de la orden obtenida exitosamente',
      );
    } catch (error) {
      // CP-POS-SVC-PERF-001 / Bugfix — same anti-leak guard as findOne.
      // VendixHttpException carries curated devMessage; anything else
      // logs the full trace and returns a generic 500 with a stable
      // error_code the frontend can switch on.
      if (error instanceof VendixHttpException) {
        return this.responseService.error(
          (error as any).devMessage || error.message,
          (error as any).userMessage || error.message,
          error.getStatus ? error.getStatus() : 400,
          (error as any).errorCode,
        );
      }
      this.logger.error(
        `[getTimeline:${id}] Unexpected error`,
        error?.stack || String(error),
      );
      return this.responseService.error(
        'No se pudo cargar la línea de tiempo.',
        'INTERNAL_TIMELINE_LOAD_001',
        500,
        'INTERNAL_TIMELINE_LOAD_001',
      );
    }
  }

  @Get(':id/payments/:paymentId/receipt-url')
  @Permissions('store:orders:read')
  async getPaymentReceiptUrl(
    @Param('id', ParseIntPipe) id: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ) {
    try {
      const result = await this.ordersService.getPaymentReceiptUrl(
        id,
        paymentId,
      );
      return this.responseService.success(
        result,
        'URL del comprobante generada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la URL del comprobante',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:orders:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    try {
      const result = await this.ordersService.update(id, updateOrderDto);
      return this.responseService.updated(
        result,
        'Orden actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Put(':id/items')
  @Permissions('store:orders:update')
  async updateOrderItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderItemsDto,
  ) {
    try {
      const result = await this.ordersService.updateOrderItems(id, dto);
      return this.responseService.updated(
        result,
        'Items de la orden actualizados exitosamente',
      );
    } catch (error) {
      // IVA cycle (F4): propaga la excepción tipada del gate al filtro.
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al actualizar los items de la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /**
   * CP-POS-CREAR-EDITAR-COBRAR-001 — C.1 · PUT /api/store/orders/:id/editor
   *
   * Editor atómico de negocio: items, cliente, notas, dirección/método/rate
   * de envío, promoción y cupón. NO edita state, payment, credit, KDS ni
   * flags fiscales (esos viven en `OrderFlowService` / flujo canónico).
   *
   * Permiso: `store:orders:update` — el mismo que `PUT /items`, pero con un
   * DTO dedicado que rechaza cualquier campo de estado/pago por construcción
   * (no por validación genérica que el `whitelist` no pueda filtrar).
   *
   * Errores tipados (códigos del catálogo):
   *  - `ORD_EDIT_INVALID_STATE_001` (409): claim atómico del estado perdió la
   *    carrera contra otro operador.
   *  - `ORD_EDIT_NOT_ALLOWED_001` (409): orden ya no es editable.
   *  - `ORD_EDIT_CUSTOMER_STORE_MISMATCH_001` (403): cliente no pertenece al
   *    store del contexto.
   *  - `ORD_EDIT_INVALID_SHIPPING_001` (422): dirección/método/rate/costo
   *    inválidos o dirección faltante en entrega a domicilio.
   *  - `ORD_EDIT_PROMOTION_INVALID_001` (422): promoción o cupón ya no aplica.
   *  - `POS_STOCK_INSUFFICIENT_001` (409): stock insuficiente al validar la
   *    edición de una orden `created`.
   *  - `ORD_EDIT_RESPONSE_MISMATCH_001` (500): persistencia OK pero la fila
   *    recargada difiere — nunca devolver éxito falso.
   */
  @Put(':id/editor')
  @Permissions('store:orders:update')
  async updateOrderEditor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderEditorDto,
  ) {
    try {
      const result = await this.ordersService.updateOrderFromEditor(id, dto);
      return this.responseService.updated(
        result,
        'Orden actualizada exitosamente',
      );
    } catch (error) {
      // Propaga las excepciones tipadas (gate de IVA, claim atómico, customer
      // store mismatch, stock insuficiente) al AllExceptionsFilter para
      // preservar status + error_code + details. El resto cae al legacy.
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al actualizar la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/shipping')
  @Permissions('store:orders:update')
  async assignShipping(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignShippingMethodDto,
  ) {
    try {
      const result = await this.ordersService.assignShipping(id, dto);
      return this.responseService.updated(
        result,
        'Método de envío asignado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al asignar método de envío',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:orders:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.ordersService.remove(id);
      return this.responseService.deleted('Orden eliminada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
