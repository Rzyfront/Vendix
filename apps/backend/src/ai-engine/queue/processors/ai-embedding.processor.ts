import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmbeddingService } from '../../embeddings/embedding.service';
import { AIEmbeddingJob } from '../interfaces/ai-queue.interface';

@Processor('ai-embedding')
export class AIEmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(AIEmbeddingProcessor.name);

  constructor(private readonly embeddingService: EmbeddingService) {
    super();
  }

  async process(
    job: Job<
      AIEmbeddingJob | { store_id: number; entity_type: string; entity_id: number }
    >,
  ): Promise<void> {
    const jobName = job.name;

    if (jobName === 'delete-embedding') {
      const data = job.data as {
        store_id: number;
        entity_type: string;
        entity_id: number;
      };
      this.logger.log(
        `Deleting embedding for ${data.entity_type}:${data.entity_id}`,
      );
      await this.embeddingService.deleteEmbedding(
        data.store_id,
        data.entity_type,
        data.entity_id,
      );
      return;
    }

    // Default: generate and store embedding
    const data = job.data as AIEmbeddingJob;
    this.logger.log(
      `Processing embedding for ${data.entity_type}:${data.entity_id}`,
    );

    await this.embeddingService.storeEmbedding({
      store_id: data.store_id,
      organization_id: data.organization_id,
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      content: data.content,
    });

    this.logger.log(
      `Embedding stored for ${data.entity_type}:${data.entity_id}`,
    );
  }
}
