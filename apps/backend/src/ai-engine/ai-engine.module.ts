import { Global, Module, OnModuleInit } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiCatalogService } from './tools/bridge/api-catalog.service';
import { createApiBridgeTools } from './tools/bridge/api-bridge.tools';
import { AIEngineService } from './ai-engine.service';
import { AILoggingService } from './ai-logging.service';
import { AIQueueModule } from './queue/ai-queue.module';
import { AIStreamController } from './ai-stream.controller';
import { AIAgentService } from './ai-agent.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { createSearchTools } from './tools/domains/search.tools';
import { uiTools } from './tools/domains/ui.tools';
import { EmbeddingModule } from './embeddings/embedding.module';
import { EmbeddingService } from './embeddings/embedding.service';
import { SubscriptionsModule } from '../domains/store/subscriptions/subscriptions.module';
import { VexiConfirmationService } from '../domains/store/vexi/vexi-confirmation.service';

/**
 * Tool registration is decentralized: each domain module registers its own
 * families against `AIToolRegistry` from its own `onModuleInit`, with its own
 * services already injected. This module registers only the two families that
 * are not owned by any domain — semantic search, whose dependency
 * (`EmbeddingService`) lives inside ai-engine, and the client-side UI command
 * declarations, which have no server dependency at all.
 *
 * Do NOT import domain modules here to register their tools. This module is
 * `@Global()`, so every such import is a dependency cycle waiting to happen,
 * and the domain count only grows.
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    AIQueueModule,
    EmbeddingModule,
    SubscriptionsModule,
    // Needed by ApiCatalogService to walk the controller graph at boot.
    DiscoveryModule,
  ],
  controllers: [AIStreamController],
  providers: [
    AIEngineService,
    AILoggingService,
    AIAgentService,
    AIToolRegistry,
    // Provided here rather than in VexiModule even though the class lives in
    // that folder: AIToolRegistry depends on it, and importing VexiModule into
    // this @Global() module would close a cycle (VexiModule imports this one).
    // Its only dependency is the globally-provided Redis client, so it
    // resolves standalone.
    VexiConfirmationService,
    ApiCatalogService,
  ],
  exports: [
    AIEngineService,
    AILoggingService,
    AIAgentService,
    AIToolRegistry,
    VexiConfirmationService,
    ApiCatalogService,
    AIQueueModule,
    EmbeddingModule,
  ],
})
export class AIEngineModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly embeddingService: EmbeddingService,
    private readonly apiCatalog: ApiCatalogService,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerMany(
      createSearchTools({ embeddingService: this.embeddingService }),
    );
    this.toolRegistry.registerMany(uiTools);
    this.toolRegistry.registerMany(
      createApiBridgeTools({ catalog: this.apiCatalog }),
    );
  }
}
