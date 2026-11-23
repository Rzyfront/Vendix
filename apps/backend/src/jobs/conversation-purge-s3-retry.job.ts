import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConversationPurgeS3Cleaner } from '../domains/store/ai-chat/conversation-purge-s3.cleaner';

/**
 * Reintenta el borrado en S3 de las conversaciones de Vex ya purgadas cuyo
 * primer intento falló. Las constancias llevan un tope de intentos
 * (`MAX_S3_PURGE_ATTEMPTS`). Como todo `@Cron`, no corre en el rol `api`.
 */
@Injectable()
export class ConversationPurgeS3RetryJob {
  private readonly logger = new Logger(ConversationPurgeS3RetryJob.name);
  private running = false;

  constructor(private readonly cleaner: ConversationPurgeS3Cleaner) {}

  @Cron('*/10 * * * *')
  async handle(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const completed = await this.cleaner.retryPending();
      if (completed > 0) {
        this.logger.log(`Conversation purge S3 retry: ${completed} completed`);
      }
      return completed;
    } catch (error) {
      this.logger.error(
        `Conversation purge S3 retry failed: ${(error as Error)?.message}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }
}
