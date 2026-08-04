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
import { VexiAttachmentsService } from '../domains/store/vexi/vexi-attachments.service';
import { VexiUiChannelService } from '../domains/store/vexi/vexi-ui-channel.service';
import { AiToolboxService } from './toolbox/ai-toolbox.service';
import { createAiToolboxTools } from './tools/domains/ai-toolbox.tools';
import { CapabilityRegistryService } from './tools/bridge/capability-registry.service';
import { createCapabilityTools } from './tools/bridge/capability.tools';
import { createPlanningTools } from './tools/domains/planning.tools';
import { createReportTools } from './tools/domains/reports.tools';
import { AIAgentProcessor } from './queue/processors/ai-agent.processor';
import { S3Module } from '../common/services/s3.module';
import { S3Service } from '../common/services/s3.service';
import { StorePrismaService } from '../prisma/services/store-prisma.service';

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
    // Vexi's attachment store and the generated-image sink live on S3. This
    // module only depends on ConfigModule, so importing it here cannot cycle.
    S3Module,
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
    // Same rule, same reason. The attachment store is needed by the api bridge
    // (to rebuild a multipart request out of a stored document) and by the
    // toolbox; the UI channel is needed by the agent loop to await a browser
    // result. Both live under `domains/store/vexi` because that is the product
    // surface they belong to, but neither can be reached through VexiModule
    // from here without closing a cycle. Their dependencies —
    // StorePrismaService, S3Service, the global Redis client — all resolve
    // standalone.
    VexiAttachmentsService,
    VexiUiChannelService,
    AiToolboxService,
    ApiCatalogService,
    CapabilityRegistryService,
    // The `ai-agent` queue was declared and never consumed, so `enqueueAgentTask`
    // added jobs nothing ran. Registered here rather than in AIQueueModule because
    // the worker needs `AIAgentService`, which lives in this module — the reverse
    // import would close a cycle.
    AIAgentProcessor,
  ],
  exports: [
    AIEngineService,
    AILoggingService,
    AIAgentService,
    AIToolRegistry,
    VexiConfirmationService,
    VexiAttachmentsService,
    VexiUiChannelService,
    AiToolboxService,
    ApiCatalogService,
    CapabilityRegistryService,
    AIQueueModule,
    EmbeddingModule,
  ],
})
export class AIEngineModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly embeddingService: EmbeddingService,
    private readonly apiCatalog: ApiCatalogService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly toolbox: AiToolboxService,
    private readonly attachments: VexiAttachmentsService,
    private readonly storePrisma: StorePrismaService,
    private readonly s3: S3Service,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerMany(
      createSearchTools({ embeddingService: this.embeddingService }),
    );
    this.toolRegistry.registerMany(uiTools);
    this.toolRegistry.registerMany(
      createApiBridgeTools({
        catalog: this.apiCatalog,
        attachments: this.attachments,
      }),
    );
    this.toolRegistry.registerMany(
      createCapabilityTools({ capabilities: this.capabilities }),
    );
    this.toolRegistry.registerMany(
      createAiToolboxTools({
        toolbox: this.toolbox,
        attachments: this.attachments,
        prisma: this.storePrisma,
        s3: this.s3,
      }),
    );
    this.toolRegistry.registerMany(createPlanningTools());
    this.toolRegistry.registerMany(createReportTools({ s3: this.s3 }));
  }
}
