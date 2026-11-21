import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AIQueueModule } from '../queue/ai-queue.module';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { EmbeddingService } from './embedding.service';
import { RAGService } from './rag.service';
import { EmbeddingEventsListener } from './embedding-events.listener';
import { EmbeddingBackfillService } from './embedding-backfill.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { createHelpTools, HelpToolsPrisma } from '../tools/domains/help.tools';
import { HelpKnowledgeIndexerService } from './help-knowledge-indexer.service';
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
    HelpKnowledgeIndexerService,
    AIEmbeddingProcessor,
  ],
  exports: [KnowledgeEmbeddingService, KnowledgeSearchService, EmbeddingService, RAGService, EmbeddingBackfillService, HelpKnowledgeIndexerService],
})
export class EmbeddingModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly prisma: GlobalPrismaService,
    private readonly helpIndexer: HelpKnowledgeIndexerService,
  ) {}

  /** T28: Vex help tools (search_help, get_help_article, get_learning_path, mark_learning_progress). */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createHelpTools({
        prisma: this.prisma as unknown as HelpToolsPrisma,
        indexer: this.helpIndexer,
      }),
    );
  }
}
