import { Injectable, Logger } from '@nestjs/common';
import {
  MessagingProvider,
  MessageResult,
  SendMessageOptions,
} from '../interfaces/messaging.interface';
import { randomUUID } from 'crypto';

@Injectable()
export class ConsoleMessagingProvider implements MessagingProvider {
  private readonly logger = new Logger(ConsoleMessagingProvider.name);

  async send(
    phone: string,
    body: string,
    options?: SendMessageOptions,
  ): Promise<MessageResult> {
    this.logger.log(
      `[CONSOLE] Message to ${phone}: ${body.substring(0, 100)}...`,
    );
    if (options?.template_id) {
      this.logger.log(`[CONSOLE] Template: ${options.template_id}`);
    }
    return { success: true, message_id: `console_${randomUUID()}` };
  }

  getName(): string {
    return 'console';
  }
}
