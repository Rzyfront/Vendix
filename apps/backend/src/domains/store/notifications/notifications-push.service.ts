import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpush = require('web-push');
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

@Injectable()
export class NotificationsPushService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsPushService.name);
  private vapid_public_key = '';
  private vapid_configured = false;

  constructor(private readonly global_prisma: GlobalPrismaService) {}

  /**
   * Read VAPID keys AFTER SecretsManagerService has loaded them into process.env.
   * Constructor runs before onModuleInit, so env vars from Secrets Manager
   * are not yet available at constructor time.
   */
  onModuleInit() {
    this.vapid_public_key = process.env.VAPID_PUBLIC_KEY || '';
    const vapid_private_key = process.env.VAPID_PRIVATE_KEY || '';
    const vapid_subject = process.env.VAPID_SUBJECT || 'mailto:support@vendix.online';

    // Strip any Base64 padding — web-push requires URL-safe Base64 without "="
    this.vapid_public_key = this.vapid_public_key.replace(/=+$/, '');
    const clean_private_key = vapid_private_key.replace(/=+$/, '');

    if (this.vapid_public_key && clean_private_key) {
      try {
        webpush.setVapidDetails(vapid_subject, this.vapid_public_key, clean_private_key);
        this.vapid_configured = true;
        this.logger.log('VAPID credentials configured');
      } catch (error: any) {
        this.logger.error(`Failed to configure VAPID: ${error.message}`);
      }
    } else {
      this.logger.warn('VAPID keys not configured — web push disabled');
    }
  }

  getPublicKey(): string {
    return this.vapid_public_key;
  }

  /**
   * Send push notification to all subscribed users in a store.
   * Queries notification_subscriptions for users with in_app: true for the given type,
   * then sends to their push_subscriptions.
   * Fire-and-forget — never throws.
   */
  async sendToStore(
    store_id: number,
    type: string,
    title: string,
    body: string,
    data?: any,
  ): Promise<void> {
    if (!this.vapid_configured) return;

    try {
      // Find users who have in_app enabled for this notification type
      const active_subs = await this.global_prisma.notification_subscriptions.findMany({
        where: { store_id, type: type as any, in_app: true },
        select: { user_id: true },
      });

      if (active_subs.length === 0) return;

      const user_ids = active_subs.map((s: any) => s.user_id);

      // Get push subscriptions for those users
      const push_subs = await this.global_prisma.push_subscriptions.findMany({
        where: { store_id, user_id: { in: user_ids } },
      });

      if (push_subs.length === 0) return;

      const payload = JSON.stringify({
        title,
        body,
        data: { ...data, type },
      });

      const send_promises = push_subs.map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
        } catch (err: any) {
          // 410 Gone or 404 — subscription expired, clean it up
          if (err.statusCode === 410 || err.statusCode === 404) {
            this.logger.log(`Removing expired push subscription #${sub.id}`);
            await this.global_prisma.push_subscriptions.delete({
              where: { id: sub.id },
            }).catch(() => {});
          } else {
            this.logger.warn(`Push failed for subscription #${sub.id}: ${err.message}`);
          }
        }
      });

      await Promise.allSettled(send_promises);
    } catch (error: any) {
      this.logger.error(`[sendToStore] Failed: ${error.message}`);
    }
  }

  /**
   * Save or update a push subscription for a user+store.
   */
  async saveSubscription(
    store_id: number,
    user_id: number,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    user_agent?: string,
  ) {
    return this.global_prisma.push_subscriptions.upsert({
      where: {
        store_id_user_id_endpoint: {
          store_id,
          user_id,
          endpoint: subscription.endpoint,
        },
      },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent,
        updated_at: new Date(),
      },
      create: {
        store_id,
        user_id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent,
      },
    });
  }

  /**
   * Remove a specific push subscription by endpoint.
   */
  async removeSubscription(store_id: number, user_id: number, endpoint: string) {
    return this.global_prisma.push_subscriptions.deleteMany({
      where: { store_id, user_id, endpoint },
    });
  }
}
