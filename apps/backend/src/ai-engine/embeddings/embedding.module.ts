import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AIQueueModule } from '../queue/ai-queue.module';
import { EmbeddingService } from './embedding.service';
import { RAGService } from './rag.service';
import { EmbeddingEventsListener } from './embedding-events.listener';
import { AIEmbeddingProcessor } from '../queue/processors/ai-embedding.processor';

@Module({
  imports: [PrismaModule, AIQueueModule],
  providers: [
    EmbeddingService,
    RAGService,
    EmbeddingEventsListener,
    AIEmbeddingProcessor,
  ],
  exports: [EmbeddingService, RAGService],
})
export class EmbeddingModule {}
