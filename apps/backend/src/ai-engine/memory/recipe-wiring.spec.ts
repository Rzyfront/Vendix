import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ProceduralMemoryService } from './procedural-memory.service';
import { RecipeRepository } from './recipe.repository';
import { RecipeQualityService } from './recipe-quality.service';
import { RecipeMinerProcessor } from './recipe-miner.processor';
import { ToolCatalogIndexerService } from '../tools/tool-catalog-indexer.service';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { AgentObjectiveRepository } from '../tasks/agent-objective.repository';
import { KnowledgeSearchService } from '../embeddings/knowledge-search.service';
import { KnowledgeEmbeddingService } from '../embeddings/knowledge-embedding.service';
import { EmbeddingService } from '../embeddings/embedding.service';
import { PlaybookLoaderService } from '../playbooks/playbook-loader.service';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { AIQueueService } from '../queue/ai-queue.service';
it('F providers resolve together with real Nest metadata and mocked boundaries, without boot/app/DB/worker', async () => {
  const providers = [
    ProceduralMemoryService,
    RecipeRepository,
    RecipeQualityService,
    RecipeMinerProcessor,
    ToolCatalogIndexerService,
  ];
  const tokens = [
    AIToolRegistry,
    AgentObjectiveRepository,
    KnowledgeSearchService,
    KnowledgeEmbeddingService,
    EmbeddingService,
    PlaybookLoaderService,
    StorePrismaService,
    GlobalPrismaService,
    AIQueueService,
    getQueueToken('ai-embedding'),
  ];
  const module = await Test.createTestingModule({
    providers: [
      ...providers,
      ...tokens.map((provide) => ({ provide, useValue: {} })),
    ],
  }).compile();
  for (const type of providers) expect(module.get(type)).toBeInstanceOf(type);
  await module.close();
});
