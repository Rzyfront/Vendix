import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { VendixHttpException, ErrorCodes } from '../../common/errors';
import { RequestContextService } from '../../common/context/request-context.service';
import {
  AIGenerationJob,
  AIEmbeddingJob,
  AIAgentJob,
  AIJobResult,
} from './interfaces/ai-queue.interface';

@Injectable()
export class AIQueueService {
  private readonly logger = new Logger(AIQueueService.name);

  constructor(
    @InjectQueue('ai-generation') private readonly generationQueue: Queue,
    @InjectQueue('ai-embedding') private readonly embeddingQueue: Queue,
    @InjectQueue('ai-agent') private readonly agentQueue: Queue,
  ) {}

  async enqueueGeneration(params: AIGenerationJob): Promise<Job> {
    try {
      const enriched: AIGenerationJob = {
        ...params,
        request_id: this.resolveRequestId(params.request_id),
      };
      const job = await this.generationQueue.add('generate', enriched, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      });
      this.logger.log(
        `Enqueued AI generation job ${job.id} for app_key: ${params.app_key} (request_id=${enriched.request_id})`,
      );
      return job;
    } catch (error: any) {
      this.logger.error(`Failed to enqueue generation: ${error.message}`);
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_001);
    }
  }

  async enqueueEmbedding(params: AIEmbeddingJob): Promise<Job> {
    try {
      const job = await this.embeddingQueue.add('embed', params, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 100 },
      });
      this.logger.log(
        `Enqueued embedding job ${job.id} for ${params.entity_type}:${params.entity_id}`,
      );
      return job;
    } catch (error: any) {
      this.logger.error(`Failed to enqueue embedding: ${error.message}`);
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_001);
    }
  }

  async enqueueAgentTask(params: AIAgentJob): Promise<Job> {
    try {
      const enriched: AIAgentJob = {
        ...params,
        request_id: this.resolveRequestId(params.request_id),
      };
      const job = await this.agentQueue.add('agent-task', enriched, {
        attempts: 1,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 25 },
      });
      this.logger.log(
        `Enqueued agent task ${job.id}: ${params.goal.substring(0, 80)} (request_id=${enriched.request_id})`,
      );
      return job;
    } catch (error: any) {
      this.logger.error(`Failed to enqueue agent task: ${error.message}`);
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_001);
    }
  }

  /**
   * Resolve the correlation id stamped onto a queued AI job.
   *
   * Order of preference:
   *   1. Explicit request_id supplied by the caller.
   *   2. The active HTTP request's X-Request-Id (via AsyncLocalStorage).
   *   3. A freshly minted UUID (job-local correlation, still dedup-safe across
   *      BullMQ retries because the same job replays the same id).
   */
  private resolveRequestId(explicit?: string): string {
    if (typeof explicit === 'string' && explicit.trim().length > 0) {
      return explicit;
    }
    const fromContext = RequestContextService.getRequestId();
    if (fromContext) return fromContext;
    return `queue-${randomUUID()}`;
  }

  async getJobStatus(queueName: string, jobId: string): Promise<AIJobResult> {
    let queue: Queue;
    switch (queueName) {
      case 'ai-generation':
        queue = this.generationQueue;
        break;
      case 'ai-embedding':
        queue = this.embeddingQueue;
        break;
      case 'ai-agent':
        queue = this.agentQueue;
        break;
      default:
        throw new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    }

    const state = await job.getState();
    return {
      job_id: job.id!,
      status: state as AIJobResult['status'],
      result: job.returnvalue,
      error: job.failedReason,
      progress: typeof job.progress === 'number' ? job.progress : undefined,
    };
  }
}
