import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  MessagingProvider,
  OutboundMessage,
  SendResult,
} from '../interfaces/messaging.interface';
import { maskAddress } from '../utils/mask-address.util';

/**
 * Development provider: logs the message and reports it as sent. Used when
 * `MESSAGING_DRY_RUN` is on (the default outside production), so dev and test
 * environments never reach a real provider.
 */
@Injectable()
export class ConsoleMessagingProvider implements MessagingProvider {
  readonly name = 'console' as const;
  private readonly logger = new Logger(ConsoleMessagingProvider.name);

  async send(message: OutboundMessage): Promise<SendResult> {
    const content = message.template
      ? `template ${message.template.name} (${message.template.language})`
      : message.media?.length
        ? `${message.media[0].type} ${message.media[0].url}`
        : (message.body ?? '').substring(0, 100);
    this.logger.log(
      `[DRY RUN] ${message.channel} to ${maskAddress(message.to)} (store ${message.store_id}, message ${message.idempotency_key}): ${content}`,
    );
    return {
      status: 'sent',
      provider: this.name,
      provider_message_id: `console_${randomUUID()}`,
      retryable: false,
    };
  }
}
