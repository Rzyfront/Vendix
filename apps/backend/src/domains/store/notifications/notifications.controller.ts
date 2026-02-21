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
import { Observable, map } from 'rxjs';
import { NotificationsService } from './notifications.service';
import { NotificationsSseService } from './notifications-sse.service';
import { NotificationsPushService } from './notifications-push.service';
import { ResponseService } from '../../../common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { NotificationQueryDto, UpdateSubscriptionDto, PushSubscriptionDto, PushUnsubscribeDto } from './dto';

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
    const result = await this.notifications_service.findAll(query_dto);
    return this.response_service.success(result.data, 'Notifications retrieved', {
      ...result.meta,
      unread_count: result.unread_count,
    });
  }

  @Get('unread-count')
  async unreadCount() {
    const result = await this.notifications_service.getUnreadCount();
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
  async markRead(@Param('id') id: string) {
    const result = await this.notifications_service.markRead(+id);
    return this.response_service.success(
      result,
      'Notification marked as read',
    );
  }

  @Patch('read-all')
  async markAllRead() {
    const result = await this.notifications_service.markAllRead();
    return this.response_service.success(result, 'All notifications marked as read');
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
    if (!user_id || !store_id) throw new ForbiddenException('User and store context required');

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
    if (!user_id || !store_id) throw new ForbiddenException('User and store context required');

    await this.push_service.removeSubscription(store_id, user_id, dto.endpoint);
    return this.response_service.success(null, 'Push subscription removed');
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new ForbiddenException('Store context required');

    const subject = this.sse_service.getOrCreate(store_id);

    return subject.pipe(
      map(
        (payload) =>
          ({
            data: JSON.stringify(payload),
          }) as MessageEvent,
      ),
    );
  }
}
