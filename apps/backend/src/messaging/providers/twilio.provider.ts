import { Injectable, Logger } from '@nestjs/common';
import {
  MessagingProvider,
  MessageResult,
  SendMessageOptions,
} from '../interfaces/messaging.interface';

@Injectable()
export class TwilioMessagingProvider implements MessagingProvider {
  private readonly logger = new Logger(TwilioMessagingProvider.name);

  constructor(private readonly config: Record<string, any>) {}

  async send(
    phone: string,
    body: string,
    options?: SendMessageOptions,
  ): Promise<MessageResult> {
    // TODO: Implement Twilio API integration
    this.logger.warn(
      `[TWILIO STUB] Would send to ${phone}: ${body.substring(0, 50)}...`,
    );
    return { success: false, error: 'Twilio provider not yet implemented' };
  }

  getName(): string {
    return 'twilio';
  }
}
