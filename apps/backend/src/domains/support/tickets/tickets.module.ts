import { Module, OnModuleInit, Optional } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SupportNotificationsModule } from '../notifications/support-notifications.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { ApiCatalogService } from '../../../ai-engine/tools/bridge/api-catalog.service';
import { createCapabilityRequestTools } from '../../../ai-engine/tools/domains/capability-request.tools';
import { buildCapabilityCorpus } from '../../../ai-engine/tools/capability-gap';
import { RequestContextService } from '@common/context/request-context.service';
import { VexClassifierService } from '../../../ai-engine/vex-classifier.service';

@Module({
  imports: [EventEmitterModule, SupportNotificationsModule],
  controllers: [TicketsController],
  providers: [
    TicketsService,
    S3Service,
    S3PathHelper,
  ],
  exports: [TicketsService],
})
export class TicketsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly apiCatalog: ApiCatalogService,
    private readonly ticketsService: TicketsService,
    // Tie-breaker only; absent or off = today's behavior.
    @Optional() private readonly classifier?: VexClassifierService,
  ) {}

  /**
   * Vex T5/T6 — `request_capability` lives with its owner (support tickets);
   * `AIEngineModule` is @Global, so the dependency points domain → engine.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createCapabilityRequestTools({
        tickets: this.ticketsService,
        classifier: this.classifier,
        corpus: () => {
          const context = RequestContextService.getContext();
          const granted = context?.permissions?.length
            ? context.permissions
            : (context?.roles ?? []);
          return buildCapabilityCorpus({
            tools: () => this.toolRegistry.getAll(),
            permittedToolNames: () =>
              new Set(
                this.toolRegistry
                  .getAvailableDefinitions(granted)
                  .map((d) => d.function.name),
              ),
            // Full release catalog: existence, not reach (playbook pattern).
            routes: () =>
              this.apiCatalog.listFor(
                [...this.apiCatalog.coveredPermissions()],
                undefined,
                undefined,
                undefined,
                { ignoreDomainScope: true },
              ),
            permittedRouteKeys: () =>
              new Set(
                this.apiCatalog
                  .listFor(granted)
                  .map((r) => `${r.method} ${r.path}`),
              ),
          });
        },
      }),
    );
  }
}
