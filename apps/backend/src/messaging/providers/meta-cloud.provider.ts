import { Injectable, Logger } from '@nestjs/common';
import {
  MessagingProvider,
  MessageResult,
  SendMessageOptions,
} from '../interfaces/messaging.interface';

@Injectable()
export class MetaCloudMessagingProvider implements MessagingProvider {
  private readonly logger = new Logger(MetaCloudMessagingProvider.name);

  constructor(private readonly config: Record<string, any>) {}

  async send(
    phone: string,
    body: string,
    options?: SendMessageOptions,
  ): Promise<MessageResult> {
    // TODO: Implement Meta Cloud API (WhatsApp Business) integration
    this.logger.warn(
      `[META CLOUD STUB] Would send to ${phone}: ${body.substring(0, 50)}...`,
    );
    return { success: false, error: 'Meta Cloud provider not yet implemented' };
  }

  getName(): string {
    return 'meta_cloud';
  }
}
