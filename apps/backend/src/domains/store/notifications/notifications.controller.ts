import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Sse,
  Req,
  ForbiddenException,
  MessageEvent,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, interval, map, merge, filter } from 'rxjs';
import { NotificationsService } from './notifications.service';
import { NotificationsSseService } from './notifications-sse.service';
import { NotificationsPushService } from './notifications-push.service';
import { ResponseService } from '../../../common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  NotificationQueryDto,
  UpdateSubscriptionDto,
  PushSubscriptionDto,
  PushUnsubscribeDto,
} from './dto';
import { SkipSubscriptionGate } from '../subscriptions/decorators/skip-subscription-gate.decorator';

@Controller('store/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications_service: NotificationsService,
    private readonly sse_service: NotificationsSseService,
    private readonly push_service: NotificationsPushService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  async findAll(@Query() query_dto: NotificationQueryDto) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;
    if (!user_id) throw new ForbiddenException('User context required');

    const result = await this.notifications_service.findAll(
      user_id,
      query_dto,
    );
    return this.response_service.success(
      result.data,
      'Notifications retrieved',
      {
        ...result.meta,
        unread_count: result.unread_count,
      },
    );
  }

  @Get('unread-count')
  async unreadCount() {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;
    if (!user_id) throw new ForbiddenException('User context required');

    const result = await this.notifications_service.getUnreadCount(user_id);
    return this.response_service.success(result);
  }

  @Get('subscriptions')
  async getSubscriptions() {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;
    if (!user_id) throw new ForbiddenException('User context required');

    const result =
      await this.notifications_service.initDefaultSubscriptions(user_id);
    return this.response_service.success(result);
  }

  @Patch('subscriptions')
  async updateSubscription(@Body() dto: UpdateSubscriptionDto) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;
    if (!user_id) throw new ForbiddenException('User context required');

    const result = await this.notifications_service.updateSubscription(
      user_id,
      dto,
    );
    return this.response_service.success(
      result,
      'Subscription updated successfully',
    );
  }

  @Patch(':id/read')
  @SkipSubscriptionGate()
  async markRead(@Param('id') id: string) {
    const result = await this.notifications_service.markRead(+id);
    return this.response_service.success(result, 'Notification marked as read');
  }

  @Patch('read-all')
  @SkipSubscriptionGate()
  async markAllRead() {
    const result = await this.notifications_service.markAllRead();
    return this.response_service.success(
      result,
      'All notifications marked as read',
    );
  }

  @Get('push/vapid-key')
  async getVapidKey() {
    return this.response_service.success({
      key: this.push_service.getPublicKey(),
    });
  }

  @Patch('push/subscribe')
  async pushSubscribe(@Body() dto: PushSubscriptionDto) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;
    const store_id = context?.store_id;
    if (!user_id || !store_id)
      throw new ForbiddenException('User and store context required');

    const result = await this.push_service.saveSubscription(
      store_id,
      user_id,
      dto.subscription,
      dto.user_agent,
    );
    return this.response_service.success(result, 'Push subscription saved');
  }

  @Patch('push/unsubscribe')
  async pushUnsubscribe(@Body() dto: PushUnsubscribeDto) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;
    const store_id = context?.store_id;
    if (!user_id || !store_id)
      throw new ForbiddenException('User and store context required');

    await this.push_service.removeSubscription(store_id, user_id, dto.endpoint);
    return this.response_service.success(null, 'Push subscription removed');
  }

  @Sse('stream')
  stream(@Req() req: Request): Observable<MessageEvent> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const user_id = context?.user_id;
    if (!store_id) throw new ForbiddenException('Store context required');

    const isStaff =
      context?.app_type === 'STORE_ADMIN' ||
      context?.app_type === 'ORG_ADMIN' ||
      context?.app_type === 'VENDIX_ADMIN';

    // QUI-854 — el subject por tienda es compartido (broadcasts). Un cliente
    // (STORE_ECOMMERCE/CUSTOMER) NO debe suscribirse a broadcasts de la tienda:
    // solo recibe sus propias notificaciones dirigidas vía subject por usuario.
    // El subject por usuario se preserva para flujos legítimos del comensal
    // (booking reschedule, avisos de reserva), nunca broadcasts operativos.
    const storeSubject = isStaff
      ? this.sse_service.getOrCreate(store_id)
      : null;
    // Per-user subject (targeted) — feeds `booking_check_in` notifications
    // like "your turn now" that should ONLY reach the assigned provider.
    const userSubject =
      user_id != null
        ? this.sse_service.getOrCreateForUser(store_id, user_id)
        : null;

    if (isStaff && user_id == null) {
      throw new ForbiddenException('Staff context required for store stream');
    }
    if (!isStaff && !userSubject) {
      throw new ForbiddenException('User context required');
    }

    req.on('close', () => {
      if (isStaff) {
        this.sse_service.unsubscribe(store_id);
      }
      if (user_id != null) {
        this.sse_service.unsubscribeUser(store_id, user_id);
      }
    });

    // Merge both streams so a single EventSource delivers both store-wide and
    // user-targeted events to the same staff client. Los clients solo reciben
    // su subject dirigido.
    const merged = !isStaff
      ? userSubject!
      : userSubject
        ? merge(storeSubject!, userSubject)
        : storeSubject!;

    // El subject por tienda es compartido: otros dominios (p.ej. el acceso
    // ambiental de gym) multiplexan sus eventos en él. El bell solo debe
    // emitir notificaciones reales — se excluyen los eventos foráneos para no
    // inflar el badge ni disparar sonido. El stream dedicado
    // /store/memberships/access/stream sí filtra su propio 'membership-access'.
    const events$ = merged.pipe(
      filter(
        (payload) =>
          (payload as { type?: string })?.type !== 'membership-access',
      ),
      map(
        (payload) =>
          ({
            data: JSON.stringify(payload),
          }) as MessageEvent,
      ),
    );

    // Heartbeat every 30s — a periodic keep-alive write so proxies/CDNs don't
    // idle-close the stream. Forcing socket I/O also makes a non-clean
    // disconnect surface as `req.on('close')`, releasing the shared Subject
    // (fixes the SSE heap leak).
    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ data: `: heartbeat ${Date.now()}` }) as MessageEvent),
    );

    return merge(events$, heartbeat$);
  }
}
