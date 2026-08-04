import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AIAgentService } from '../../ai-agent.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { AIAgentJob } from '../interfaces/ai-queue.interface';

/**
 * Runs an agent turn with no user waiting on it.
 *
 * The `ai-agent` queue has existed and been unconsumed since it was declared, so
 * `enqueueAgentTask` added jobs that nothing ever ran. This is its worker.
 *
 * One property defines what a background task may do: **there is no bearer token
 * here**. A queued job has no HTTP request behind it, so `write_endpoint` refuses
 * (it checks for the caller's token before anything else) and every
 * confirmation-gated tool still throws its approval demand. That is the correct
 * shape rather than a limitation to work around — the business rule is that
 * nothing applies without the person saying yes, and a background job is by
 * definition a place where nobody can say yes. What a task does, then, is the
 * expensive read-side work: validating 200 rows against the real catalog, sweeping
 * a month of orders for inconsistencies, preparing a bulk upload. The proposal
 * comes back to the chat, where it can be approved.
 *
 * Permissions are restored from the job rather than re-resolved. The tool catalog
 * is filtered by them, and re-reading the user's roles at run time would let a role
 * change between enqueue and execution silently widen or empty the task.
 */
@Processor('ai-agent')
export class AIAgentProcessor extends WorkerHost {
  private readonly logger = new Logger(AIAgentProcessor.name);

  constructor(
    private readonly aiAgent: AIAgentService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<AIAgentJob>): Promise<any> {
    const { goal, task_id } = job.data;

    this.logger.log(
      `Processing Vexi agent task ${job.id} (task_id=${task_id ?? 'none'}): ${goal.slice(0, 80)}`,
    );

    const requestId = job.data.request_id?.trim()
      ? job.data.request_id
      : `queue-${randomUUID()}`;

    try {
      const result = await RequestContextService.run(
        {
          is_super_admin: false,
          is_owner: false,
          store_id: job.data.store_id,
          organization_id: job.data.organization_id,
          user_id: job.data.user_id,
          permissions: job.data.permissions,
          roles: job.data.roles,
          request_id: requestId,
        },
        () =>
          this.aiAgent.runAgent({
            goal,
            app_key: job.data.app_key ?? 'chat_assistant',
            tools: job.data.tools,
            max_iterations: job.data.max_iterations,
            timeout_ms: job.data.timeout_ms,
          }),
      );

      this.eventEmitter.emit('vexi.task.finished', {
        job_id: job.id,
        task_id,
        store_id: job.data.store_id,
        user_id: job.data.user_id,
        conversation_id: job.data.conversation_id,
        goal,
        success: result.success,
        content: result.content,
        tools_used: result.tools_used?.length ?? 0,
      });

      return result;
    } catch (error: any) {
      this.logger.error(`Vexi agent task ${job.id} failed: ${error?.message}`);

      // Emitted, not swallowed: the person is not watching, so the only way they
      // learn the task died is the notification this event drives.
      this.eventEmitter.emit('vexi.task.finished', {
        job_id: job.id,
        task_id,
        store_id: job.data.store_id,
        user_id: job.data.user_id,
        conversation_id: job.data.conversation_id,
        goal,
        success: false,
        error: error?.message ?? 'Error desconocido',
      });

      throw error;
    }
  }
}
