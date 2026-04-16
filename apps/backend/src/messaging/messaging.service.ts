import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { MessagingProvider, MessageResult, SendMessageOptions } from './interfaces/messaging.interface';
import { ConsoleMessagingProvider } from './providers/console.provider';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  private readonly consoleProvider = new ConsoleMessagingProvider();

  constructor(private readonly prisma: GlobalPrismaService) {}

  async sendToCustomer(
    storeId: number,
    channel: 'whatsapp' | 'sms',
    phone: string,
    body: string,
    options?: SendMessageOptions,
  ): Promise<MessageResult> {
    try {
      const channelConfig = await this.prisma.messaging_channels.findFirst({
        where: { store_id: storeId, channel_type: channel, is_active: true },
      });

      if (!channelConfig) {
        this.logger.debug(`No ${channel} channel configured for store ${storeId}, using console`);
        return this.consoleProvider.send(phone, body, options);
      }

      const provider = this.resolveProvider(channelConfig.provider, channelConfig.config as Record<string, any>);
      const result = await provider.send(phone, body, options);

      if (!result.success) {
        this.logger.warn(`Failed to send ${channel} to ${phone} via ${channelConfig.provider}: ${result.error}`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Error sending ${channel} message: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private resolveProvider(providerName: string, config: Record<string, any>): MessagingProvider {
    switch (providerName) {
      case 'twilio':
        // Lazy import to avoid loading unused providers
        const { TwilioMessagingProvider } = require('./providers/twilio.provider');
        return new TwilioMessagingProvider(config);
      case 'meta_cloud':
        const { MetaCloudMessagingProvider } = require('./providers/meta-cloud.provider');
        return new MetaCloudMessagingProvider(config);
      default:
        this.logger.warn(`Unknown provider: ${providerName}, falling back to console`);
        return this.consoleProvider;
    }
  }
}
