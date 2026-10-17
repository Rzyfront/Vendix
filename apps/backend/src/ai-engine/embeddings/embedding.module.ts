import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AIQueueModule } from '../queue/ai-queue.module';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { EmbeddingService } from './embedding.service';
import { RAGService } from './rag.service';
import { EmbeddingEventsListener } from './embedding-events.listener';
import { EmbeddingBackfillService } from './embedding-backfill.service';
import { AIEmbeddingProcessor } from '../queue/processors/ai-embedding.processor';

@Module({
  imports: [PrismaModule, AIQueueModule],
  providers: [
    EmbeddingService,
    KnowledgeEmbeddingService,
    KnowledgeSearchService,
    RAGService,
    EmbeddingEventsListener,
    EmbeddingBackfillService,
    AIEmbeddingProcessor,
  ],
  exports: [KnowledgeEmbeddingService, KnowledgeSearchService, EmbeddingService, RAGService, EmbeddingBackfillService],
})
export class EmbeddingModule {}
