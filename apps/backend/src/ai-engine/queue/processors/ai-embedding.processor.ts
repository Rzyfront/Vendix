import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmbeddingService } from '../../embeddings/embedding.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ToolCatalogIndexerService } from '../../tools/tool-catalog-indexer.service';
import { AIEmbeddingJob, AIKnowledgeIndexJob } from '../interfaces/ai-queue.interface';

@Processor('ai-embedding')
export class AIEmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(AIEmbeddingProcessor.name);

  constructor(private readonly embeddingService: EmbeddingService,
    @Optional() @Inject(forwardRef(() => ToolCatalogIndexerService)) private readonly knowledgeIndexer?: ToolCatalogIndexerService) {
    super();
  }

  async process(
    job: Job<
      | AIEmbeddingJob
      | AIKnowledgeIndexJob
      | { store_id: number; entity_type: string; entity_id: number }
    >,
  ): Promise<void> {
    const jobName = job.name;

    if (jobName === 'index-knowledge') {
      if (!this.knowledgeIndexer) throw new Error('KNOWLEDGE_INDEXER_UNAVAILABLE');
      await this.knowledgeIndexer.indexBatch(job.data as AIKnowledgeIndexJob);
      return;
    }

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

    if (jobName !== 'embed') throw new Error('UNKNOWN_EMBEDDING_JOB');

    // Default: generate and store embedding
    const data = job.data as AIEmbeddingJob;
    this.logger.log(
      `Processing embedding for ${data.entity_type}:${data.entity_id}`,
    );

    // Re-establish the tenant context so AIEngineService can consume the
    // subscription quota (it reads store_id/request_id from AsyncLocalStorage).
    await RequestContextService.run(
      {
        is_super_admin: false,
        is_owner: false,
        store_id: data.store_id,
        organization_id: data.organization_id,
        request_id: `embedding:${data.entity_type}:${data.entity_id}:${job.id}`,
      },
      () =>
        this.embeddingService.storeEmbedding({
          store_id: data.store_id,
          organization_id: data.organization_id,
          entity_type: data.entity_type,
          entity_id: data.entity_id,
          content: data.content,
        }),
    );

    this.logger.log(
      `Embedding stored for ${data.entity_type}:${data.entity_id}`,
    );
  }
}
