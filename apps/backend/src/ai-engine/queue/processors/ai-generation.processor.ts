import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AIEngineService } from '../../ai-engine.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { AIGenerationJob } from '../interfaces/ai-queue.interface';

@Processor('ai-generation')
export class AIGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(AIGenerationProcessor.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<AIGenerationJob>): Promise<any> {
    const { app_key, variables, extra_messages } = job.data;

    this.logger.log(
      `Processing AI generation job ${job.id} for app_key: ${app_key}`,
    );

    // Re-establish the request context inside the worker so downstream
    // services (AIEngineService.consumeSubscriptionQuota in particular) can
    // read store_id / user_id / request_id from AsyncLocalStorage. The
    // request_id is what makes the AI quota counter dedup-safe across BullMQ
    // retries (same job → same request_id → at most one increment per period).
    const requestId =
      job.data.request_id && job.data.request_id.trim().length > 0
        ? job.data.request_id
        : `queue-${randomUUID()}`;

    try {
      const messages = extra_messages?.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));

      const response = await RequestContextService.run(
        {
          is_super_admin: false,
          is_owner: false,
          store_id: job.data.store_id,
          organization_id: job.data.organization_id,
          user_id: job.data.user_id,
          request_id: requestId,
        },
        () => this.aiEngine.run(app_key, variables, messages),
      );

      this.eventEmitter.emit('ai.generation.completed', {
        job_id: job.id,
        app_key,
        success: response.success,
        store_id: job.data.store_id,
        organization_id: job.data.organization_id,
        callback_event: job.data.callback_event,
        result: response,
      });

      return response;
    } catch (error: any) {
      this.logger.error(`AI generation job ${job.id} failed: ${error.message}`);

      this.eventEmitter.emit('ai.generation.failed', {
        job_id: job.id,
        app_key,
        error: error.message,
        store_id: job.data.store_id,
        organization_id: job.data.organization_id,
      });

      throw error;
    }
  }
}
