import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  MessageEvent,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import {
  EMPTY,
  Observable,
  Subject,
  defer,
  from,
  interval,
  merge,
  of,
} from 'rxjs';
import { filter, map, switchMap } from 'rxjs/operators';
import { Public } from '@common/decorators/public.decorator';
import { OptionalAuth } from '@common/decorators/optional-auth.decorator';
import { RequestContextService } from '@common/context/request-context.service';
import { NotificationsSseService } from '../../store/notifications/notifications-sse.service';
import { InvoiceDataRequestsService } from '../../store/invoicing/invoice-data-requests/invoice-data-requests.service';
import type { GuestStreamBinding } from '../../store/invoicing/invoice-data-requests/invoice-data-requests.service';
import { SubmitInvoiceDataDto } from '../../store/invoicing/invoice-data-requests/dto/submit-invoice-data.dto';
import { ResponseService } from '@common/responses/response.service';

/**
 * Paso 6 — mismo mapa productor→guest que el stream comensal
 * (`DINER_KDS_MAP` en `EcommerceTablesController`): los eventos `ticket.*`
 * que `KitchenFireService` empuja al subject por tienda se renombran al
 * vocabulario presentacional. Copia local a propósito: el mapa comensal es
 * privado de su controller y cruzar dominios para 4 líneas no compensa.
 * Cualquier tipo fuera de este mapa (y de los tres eventos `order.*`
 * allowlist) lo niega `matchesGuest` por defecto.
 */
const GUEST_KDS_MAP: Record<string, string> = {
  'ticket.created': 'kitchen.fired',
  'ticket.started': 'kitchen.preparing',
  'ticket.ready': 'kitchen.ready',
  'ticket.delivered': 'kitchen.delivered',
};

@Controller('ecommerce/invoice-data')
export class EcommerceInvoiceDataController {
  private readonly logger = new Logger(EcommerceInvoiceDataController.name);

  constructor(
    private readonly invoiceDataService: InvoiceDataRequestsService,
    private readonly responseService: ResponseService,
    private readonly sseService: NotificationsSseService,
  ) {}

  @Public()
  @Get(':token/order-summary')
  async getOrderSummary(@Param('token') token: string) {
    const summary = await this.invoiceDataService.getOrderSummaryByToken(token);
    return this.responseService.success(summary);
  }

  /**
   * Paso 4 (roku-shop-checkout-tarifa-detalle-orden) — clon guest de
   * `GET /ecommerce/payments/:paymentId/receipt-url`: URL firmada TTL 5 min
   * al comprobante de transferencia/voucher. `@OptionalAuth` (nunca JWT en
   * query para guest): la autorización es el binding server-side
   * token→orden→pago, con 404 ciego si no hay vínculo.
   */
  @OptionalAuth()
  @Get(':token/payments/:paymentId/receipt-url')
  async getGuestPaymentReceiptUrl(
    @Param('token') token: string,
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ) {
    const data = await this.invoiceDataService.getGuestPaymentReceiptUrl(
      token,
      paymentId,
    );
    return this.responseService.success(data);
  }

  /**
   * Paso 4 — subida tardía del comprobante desde la vista guest. Mismo
   * contrato que el checkout: `multipart/form-data` con `file`, 5 MB
   * (multer corta con 413), MIME imagen/PDF, solo bank_transfer/voucher.
   */
  @OptionalAuth()
  @Post(':token/payments/:paymentId/receipt')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadGuestPaymentReceipt(
    @Param('token') token: string,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const data = await this.invoiceDataService.uploadGuestPaymentReceipt(
      token,
      paymentId,
      file,
    );
    return this.responseService.success(
      data,
      'Comprobante recibido. La tienda lo revisará para confirmar tu pago.',
    );
  }

  /**
   * Paso 6 (roku-shop-checkout-tarifa-detalle-orden) — stream SSE guest de
   * seguimiento del pedido. Clon comensal
   * (`EcommerceTablesController.stream`) sin dispositivos ni sesiones:
   *   1) Un `snapshot` inicial con el estado vivo de la orden (mismo shape
   *      del summary + cocina por plato, proyectado con whitelist).
   *   2) Eventos vivos allowlist filtrados por la orden del binding:
   *      `kitchen.fired|preparing|ready|delivered` (match
   *      `ticket.order_id`) y `order.status_changed` /
   *      `order.shipping_assigned` / `order.payment_updated`
   *      (match `data.order_id`).
   *   3) Heartbeat `: heartbeat` cada 30s.
   *
   * Seguridad (default-deny): `@OptionalAuth` con token en path (nunca JWT
   * en query para guest); el binding `{order_id, store_id}` se deriva
   * SERVER-SIDE del token y la tienda del host
   * (`DomainResolverMiddleware`: host, `x-store-id` o `?store_id=`) debe
   * coincidir con la de la orden. Token inválido o tienda ajena ⇒ la
   * conexión se cierra sin emitir ningún dato (ciego, sin distinguirlos).
   * La proyección elimina costos/settings/PII de terceros/staff/JWTs/notas.
   *
   * `link_expired` es el tipo de cierre RESERVADO para cuando el enlace
   * tenga expiración (dependencia F2 del plan — hoy el token guest no
   * expira, así que nunca se emite).
   *
   * ALS caveat (igual que mesa): el contexto se captura SINCRÓNICO y cada
   * lectura diferida (binding + snapshot) se re-envuelve en
   * `RequestContextService.run(...)`; si no, `StorePrismaService` no vería
   * `store_id` (el AsyncLocalStorage ya se desenrolló) y lanzaría
   * STORE_CONTEXT_001.
   */
  @Sse(':token/stream')
  @OptionalAuth()
  stream(
    @Param('token') token: string,
    @Req() req: Request,
  ): Observable<MessageEvent> {
    // 1) Contexto SINCRÓNICO (antes de devolver el Observable). Sin tienda
    //    del host no hay subject al cual suscribirse ⇒ 403, igual que mesa.
    const requestContext = RequestContextService.getContext();
    const storeId = requestContext?.store_id;
    if (!requestContext || !storeId) {
      throw new ForbiddenException('Store context required');
    }

    // 2) Binding server-side diferido: token inválido, de otra tienda o
    //    cliente ya desconectado ⇒ `EMPTY` (la conexión muere sin datos).
    //    `getOrCreate` solo corre en la rama permitida, así que el deny no
    //    deja refcount colgado en el subject por tienda.
    return defer(() =>
      from(
        RequestContextService.run(requestContext, () =>
          this.invoiceDataService.resolveGuestStreamBinding(token),
        ),
      ).pipe(
        switchMap((binding) => {
          if (!binding || binding.store_id !== storeId || req.destroyed) {
            // F3: el token es la capability guest — jamás se loguea.
            this.logger.debug(
              `Guest SSE denied for store ${storeId} (unbound token)`,
            );
            return EMPTY;
          }
          const subject = this.sseService.getOrCreate(storeId);
          req.on('close', () => this.sseService.unsubscribe(storeId));

          const snapshot$ = defer(() =>
            from(
              RequestContextService.run(requestContext, () =>
                this.invoiceDataService.getOrderSummaryByToken(token),
              ).then(
                (summary) =>
                  ({
                    data: JSON.stringify({
                      type: 'snapshot',
                      order: this.projectGuestSnapshot(summary),
                      ts: Date.now(),
                    }),
                  }) as MessageEvent,
                // El binding ya resolvió: si el summary falla es una raza
                // (solicitud borrada en el medio) ⇒ cierre limpio sin datos.
                () => null,
              ),
            ).pipe(switchMap((msg) => (msg ? of(msg) : EMPTY))),
          );

          // El subject por tienda trae una unión mixta (bell +
          // `KdsSseEvent` como `any` + `SseNotificationPayload` de
          // `OrderSseService`), así que el cast a record suelto es el único
          // necesario (igual que mesa).
          const live$ = (
            subject as unknown as Subject<Record<string, unknown>>
          ).pipe(
            filter((ev) => this.matchesGuest(ev, binding)),
            map(
              (ev) =>
                ({
                  data: JSON.stringify(this.projectForGuest(ev)),
                }) as MessageEvent,
            ),
          );

          const heartbeat$ = interval(30_000).pipe(
            map(() => ({ data: ': heartbeat' }) as MessageEvent),
          );

          return merge(snapshot$, live$, heartbeat$);
        }),
      ),
    );
  }

  @Public()
  @Get(':token')
  async getRequestInfo(@Param('token') token: string) {
    const request = await this.invoiceDataService.getByToken(token);
    return this.responseService.success(request);
  }

  @Public()
  @Post(':token/submit')
  async submitData(
    @Param('token') token: string,
    @Body() dto: SubmitInvoiceDataDto,
  ) {
    const result = await this.invoiceDataService.submitData(token, dto);
    return this.responseService.success(
      result,
      'Datos de facturación recibidos correctamente',
    );
  }

  // ------------------------------------------------- guest stream filter
  /**
   * Default-deny para el stream guest. Acepta SOLO:
   *   - Eventos KDS allowlist (`GUEST_KDS_MAP`) con
   *     `ticket.order_id === binding.order_id`.
   *   - `order.status_changed` / `order.shipping_assigned` /
   *     `order.payment_updated` con `data.order_id === binding.order_id`.
   * Todo lo demás — otros tipos, otras órdenes — se descarta: el guest
   * nunca observa actividad ajena de la tienda.
   */
  private matchesGuest(
    ev: Record<string, unknown>,
    binding: GuestStreamBinding,
  ): boolean {
    const type = typeof ev?.type === 'string' ? (ev.type as string) : '';
    if (!type) return false;

    if (GUEST_KDS_MAP[type]) {
      const ticket = ev.ticket as { order_id?: number } | undefined;
      return ticket?.order_id === binding.order_id;
    }
    if (
      type === 'order.status_changed' ||
      type === 'order.shipping_assigned' ||
      type === 'order.payment_updated'
    ) {
      const data = ev.data as { order_id?: number } | undefined;
      return data?.order_id === binding.order_id;
    }
    return false;
  }

  /**
   * Proyecta un evento crudo del subject por tienda al payload guest.
   * Whitelist campo por campo — cualquier campo desconocido del productor
   * se descarta (costos, settings, PII de terceros, staff, notas internas).
   */
  private projectForGuest(ev: Record<string, unknown>): Record<string, unknown> {
    const type = typeof ev?.type === 'string' ? (ev.type as string) : '';

    if (type === 'order.status_changed') {
      const raw = (ev.data ?? {}) as Record<string, unknown>;
      const projected: Record<string, unknown> = { type };
      for (const key of [
        'order_id',
        'order_number',
        'old_state',
        'new_state',
      ]) {
        if (raw[key] !== undefined) {
          projected[key] = raw[key];
        }
      }
      projected.ts = Date.now();
      return projected;
    }

    if (type === 'order.shipping_assigned') {
      const raw = (ev.data ?? {}) as Record<string, unknown>;
      const projected: Record<string, unknown> = { type };
      // `shipping_method_id` se descarta a propósito: FK interno fuera del
      // shape guest; `delivery_type` es el dato presentacional.
      for (const key of ['order_id', 'delivery_type']) {
        if (raw[key] !== undefined) {
          projected[key] = raw[key];
        }
      }
      projected.ts = Date.now();
      return projected;
    }

    // Pago en vivo guest (`/pedido/:token`): emitido por
    // `OrderFlowService.confirmPayment` tras commit. Mismo shape por pago
    // que el snapshot (`payment_id, state, has_receipt`): el frontend ya
    // fusiona por `payment_id` en `paymentsLive`.
    if (type === 'order.payment_updated') {
      const raw = (ev.data ?? {}) as Record<string, unknown>;
      const rawPayments = Array.isArray(raw.payments)
        ? (raw.payments as Array<Record<string, unknown>>)
        : [];
      const projected: Record<string, unknown> = { type };
      if (raw.order_id !== undefined) {
        projected.order_id = raw.order_id;
      }
      projected.payments = rawPayments.map((p) => ({
        payment_id: p.payment_id ?? null,
        state: p.state ?? null,
        has_receipt: p.has_receipt ?? null,
      }));
      projected.ts = Date.now();
      return projected;
    }

    // Rama KDS — misma proyección comensal: sin COGS/costos/receta/sku ni
    // ids internos; solo estado presentacional del plato.
    const guestType = GUEST_KDS_MAP[type] ?? 'kitchen.update';
    const ticket = (ev.ticket ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(ticket.items)
      ? (ticket.items as Array<Record<string, unknown>>)
      : [];

    return {
      type: guestType,
      ticket: {
        id: ticket.id ?? null,
        status: ticket.status ?? null,
        daily_number: ticket.daily_number ?? null,
        fired_at: ticket.fired_at ?? null,
        ready_at: ticket.ready_at ?? null,
        items: rawItems.map((it) => {
          const product = (it.product ?? {}) as Record<string, unknown>;
          return {
            // CP-853-fix (paso 5): clave por línea (siempre presente en
            // `kitchen_ticket_items.order_item_id`, columna NOT NULL).
            order_item_id: it.order_item_id ?? null,
            product_name: product.name ?? null,
            quantity: it.quantity ?? null,
            status: it.status ?? null,
          };
        }),
      },
      ts: (ev.ts as number) ?? Date.now(),
    };
  }

  /**
   * Snapshot inicial: subconjunto vivo del summary (mismo shape + cocina)
   * con whitelist de campos. Sin customer/tienda/totales/factura: la página
   * ya los trae por REST y el stream solo calienta el estado que cambia en
   * vivo (estado de orden, cocina por plato, estado de pagos).
   */
  private projectGuestSnapshot(
    summary: Awaited<
      ReturnType<InvoiceDataRequestsService['getOrderSummaryByToken']>
    >,
  ): Record<string, unknown> {
    const order = summary.order;
    return {
      id: order.id,
      order_number: order.order_number,
      state: order.state,
      delivery_type: order.delivery_type,
      estimated_ready_at: order.estimated_ready_at,
      estimated_delivered_at: order.estimated_delivered_at,
      prep_minutes_max: order.prep_minutes_max,
      items: order.items.map((it) => ({
        // CP-853-fix (paso 5): clave por línea, misma que el resumen REST.
        order_item_id: it.order_item_id,
        product_name: it.product_name,
        quantity: it.quantity,
        kitchen_status: it.kitchen_status,
        preparation_time_minutes: it.preparation_time_minutes,
      })),
      payments: order.payments.map((p) => ({
        payment_id: p.payment_id,
        state: p.state,
        has_receipt: p.has_receipt,
      })),
    };
  }
}
