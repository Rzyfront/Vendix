import { ProceduralMemoryService } from './memory/procedural-memory.service';
import { RecipeQualityService } from './memory/recipe-quality.service';
import { RecipeRepository } from './memory/recipe.repository';
import { RecipeMinerProcessor } from './memory/recipe-miner.processor';

import { createProceduralRecipeTools } from './tools/domains/recipe.tools';
import { AgentVerifierService } from './tasks/agent-verifier.service';
import { SandboxBrokerService } from './sandbox/sandbox-broker.service';
import { SandboxClientService } from './sandbox/sandbox-client.service';
import { SandboxPolicyService } from './sandbox/sandbox-policy.service';
import { SandboxAuditRepository } from './sandbox/sandbox-audit.repository';
import { SandboxLambdaClientService } from './sandbox/sandbox-lambda-client.service';
import { CodeModeBridgeService } from './sandbox/codemode-bridge.service';
import { CodeModePolicyService } from './sandbox/codemode-policy.service';
import { SandboxAnalysisBrokerService } from './sandbox/sandbox-analysis-broker.service';
import { SandboxStoreSlotService } from './sandbox/sandbox-store-slot.service';

import { createCodeExecutionTools } from './tools/domains/code-execution.tools';
import { Global, Module, OnModuleInit } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiCatalogService } from './tools/bridge/api-catalog.service';
import { createApiBridgeTools } from './tools/bridge/api-bridge.tools';
import { AIEngineService } from './ai-engine.service';
import { AgentRuntimeConfigService } from './agent-runtime-config.service';
import { AILoggingService } from './ai-logging.service';
import { AgentTraceService } from './observability/agent-trace.service';
import { VexClassifierService } from './vex-classifier.service';
import { AgentGuardrailService } from './guardrail/agent-guardrail.service';
import { AIQueueModule } from './queue/ai-queue.module';
import { AIStreamController } from './ai-stream.controller';
import { AIAgentService } from './ai-agent.service';
import { ToolRouterService } from './tools/tool-router.service';
import { ToolCatalogIndexerService } from './tools/tool-catalog-indexer.service';
import { createDiscoveryTools } from './tools/domains/discovery.tools';
import { PlaybookLoaderService } from './playbooks/playbook-loader.service';
import { PlaybookService } from './playbooks/playbook.service';
import { createPlaybookTools } from './tools/domains/playbook.tools';

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
import { DocumentPagesService } from '../common/ai-ingest/documents/document-pages.service';
import { createAiToolboxTools } from './tools/domains/ai-toolbox.tools';
import { CapabilityRegistryService } from './tools/bridge/capability-registry.service';
import { createCapabilityTools } from './tools/bridge/capability.tools';
import { createPlanningTools } from './tools/domains/planning.tools';
import { createTurnTools } from './tools/domains/turn.tools';
import { createReportTools } from './tools/domains/reports.tools';
import { AIAgentProcessor } from './queue/processors/ai-agent.processor';
import { AgentObjectiveRepository } from './tasks/agent-objective.repository';
import { AgentTaskContextService } from './tasks/agent-task-context.service';
import { AgentEvidenceService } from './tasks/agent-evidence.service';
import { AgentDurableSessionService } from './tasks/agent-durable-session.service';
import { S3Module } from '../common/services/s3.module';
import { S3Service } from '../common/services/s3.service';
import { ConversationCompactorService } from './context/conversation-compactor.service';
import { RequestContextService } from '../common/context/request-context.service';

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
    AgentRuntimeConfigService,
    AILoggingService,
    AgentTraceService,
    AIAgentService,
    AgentObjectiveRepository,
    AgentTaskContextService,
    AgentEvidenceService,
    AgentDurableSessionService,
    AgentVerifierService,
    ProceduralMemoryService,
    RecipeQualityService,
    RecipeRepository,
    RecipeMinerProcessor,
    SandboxBrokerService,
    SandboxClientService,
    SandboxPolicyService,
    SandboxAuditRepository,
    SandboxLambdaClientService,
    SandboxStoreSlotService,
    SandboxAnalysisBrokerService,
    CodeModePolicyService,
    CodeModeBridgeService,
    AIToolRegistry,
    ToolRouterService,
    ToolCatalogIndexerService,
    PlaybookLoaderService,
    PlaybookService,
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
    // ia-cargas F5a: the toolbox prepares documents with the shared ai-ingest
    // page service. Provided here as a plain class (no dependencies) and NOT
    // exported; importing `AiIngestModule` would close a cycle, because its
    // extraction service needs `AIEngineService` from this module.
    DocumentPagesService,
    ApiCatalogService,
    CapabilityRegistryService,
    // The `ai-agent` queue was declared and never consumed, so `enqueueAgentTask`
    // added jobs nothing ran. Registered here rather than in AIQueueModule because
    // the worker needs `AIAgentService`, which lives in this module — the reverse
    // import would close a cycle.
    AIAgentProcessor,
    ConversationCompactorService,
    // Vex tie-breaker classifier: optional opinion, never replaces text.
    VexClassifierService,
    // Pre-turn guardrail of Vex/Vexi: fail-open, off until configured.
    AgentGuardrailService,
  ],
  exports: [
    VexClassifierService,
    AgentGuardrailService,
    AgentObjectiveRepository,
    AgentTaskContextService,
    AgentEvidenceService,
    AgentDurableSessionService,
    AgentVerifierService,
    SandboxLambdaClientService,
    SandboxAnalysisBrokerService,
    CodeModeBridgeService,
    CodeModePolicyService,
    // F10/T67: «Ver cómo lo calculé» reads runs from the Vex history service.
    SandboxAuditRepository,
    AIEngineService,
    AgentRuntimeConfigService,
    AILoggingService,
    AgentTraceService,
    AIAgentService,
    AIToolRegistry,
    ToolRouterService,
    ToolCatalogIndexerService,
    PlaybookLoaderService,
    PlaybookService,
    VexiConfirmationService,
    VexiAttachmentsService,
    VexiUiChannelService,
    AiToolboxService,
    ApiCatalogService,
    CapabilityRegistryService,
    AIQueueModule,
    EmbeddingModule,
    ConversationCompactorService,
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
    private readonly s3: S3Service,
    private readonly sandbox: SandboxBrokerService,
  ) {}

  onModuleInit() {
    this.toolRegistry.registerMany(createProceduralRecipeTools());
    this.toolRegistry.registerMany(createCodeExecutionTools(this.sandbox));
    this.toolRegistry.registerMany(createPlaybookTools());
    this.toolRegistry.registerMany(createDiscoveryTools());
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
      createCapabilityTools({
        capabilities: this.capabilities,
        // T7: native tools the caller's permissions reach, same gate as the
        // turn's tool list (getAvailableDefinitions).
        nativeTools: () => {
          const context = RequestContextService.getContext();
          const granted = context?.permissions?.length
            ? context.permissions
            : (context?.roles ?? []);
          const permitted = new Set(
            this.toolRegistry
              .getAvailableDefinitions(granted)
              .map((d) => d.function.name),
          );
          return this.toolRegistry
            .getAll()
            .filter((tool) => permitted.has(tool.name) && !tool.clientSide)
            .map((tool) => ({
              name: tool.name,
              domain: tool.domain,
              description: tool.description,
              readOnly: tool.readOnly === true,
            }));
        },
      }),
    );
    this.toolRegistry.registerMany(
      createAiToolboxTools({
        toolbox: this.toolbox,
        attachments: this.attachments,
        s3: this.s3,
      }),
    );
    this.toolRegistry.registerMany(createPlanningTools());
    this.toolRegistry.registerMany(createTurnTools());
    this.toolRegistry.registerMany(createReportTools({ s3: this.s3 }));
  }
}
