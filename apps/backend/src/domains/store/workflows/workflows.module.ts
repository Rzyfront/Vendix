import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createWorkflowsTools } from '../../../ai-engine/tools/domains/workflows.tools';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { resolveStoreTimezone } from '../../../common/utils/store-timezone.util';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DocumentsModule } from '../documents/documents.module';
import { EmailModule } from '../../../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowAdvanceService } from './engine/workflow-advance.service';
import { WorkflowAssignmentService } from './engine/workflow-assignment.service';
import { WorkflowCompleteService } from './engine/workflow-complete.service';
import { WorkflowRequirementsService } from './engine/workflow-engine.types';
import { WorkflowEmailService } from './engine/workflow-email.service';
import { WorkflowEngineService } from './engine/workflow-engine.service';
import { WorkflowEventsService } from './engine/workflow-events.service';
import { WorkflowLoaderService } from './engine/workflow-loader.service';
import { WorkflowOutboxDispatcher } from './engine/workflow-outbox.dispatcher';
import { WorkflowReferenceService } from './engine/workflow-reference.service';
import { DossierWorkflowRequirementsService } from './engine/workflow-requirements.service';
import { WorkflowStageService } from './engine/workflow-stage.service';
import { WorkflowStartService } from './engine/workflow-start.service';
import { WorkflowTickService } from './engine/workflow-tick.service';
import { WorkflowTimersCron } from './engine/workflow-timers.cron';
import { WorkGroupsController } from './work-groups.controller';
import { WorkGroupsService } from './work-groups.service';
import { WorkflowDefinitionsController } from './definitions/workflow-definitions.controller';
import { WorkflowDefinitionsService } from './definitions/workflow-definitions.service';
import { WorkflowSimulatorService } from './definitions/workflow-simulator.service';
import { WorkflowInstancesController } from './instances/workflow-instances.controller';
import { WorkflowInstancesService } from './instances/workflow-instances.service';
import { DocumentFilesController } from './files/document-files.controller';
import { WorkflowFilesService } from './files/workflow-files.service';
import { WorkflowBoardController } from './board/workflow-board.controller';
import { WorkflowBoardService } from './board/workflow-board.service';
import { WorkflowInboxController } from './inbox/workflow-inbox.controller';
import { WorkflowInboxService } from './inbox/workflow-inbox.service';
import { WorkflowCommentsService } from './instances/workflow-comments.service';
import { WorkflowPublicLinksService } from './public-link/workflow-public-links.service';
import { WorkflowMetricsService } from './metrics/workflow-metrics.service';
import { WorkflowTasksController } from './tasks/workflow-tasks.controller';

/**
 * Flujos: motor (start / completeTask / claim / transition / cancel / tick),
 * grupos de trabajo, despachador de outbox y temporizadores. Operación (bloque 8): bandeja `inbox`, tablero `board`, comentarios, enlace público y correo.
 * Controladores (bloque 4):
 * `store/workflows/{definitions,instances,tasks}` y `store/work-groups`.
 * `WorkflowRequirementsService` se evalúa contra el expediente de la instancia (`DocumentsModule`):
 * `upload` y `file_field` reales; `issued_document` / `signature` llegan en tareas documentales posteriores.
 */
@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    EmailModule,
    ResponseModule,
    DocumentsModule,
  ],
  controllers: [
    WorkflowDefinitionsController,
    WorkflowInstancesController,
    WorkflowTasksController,
    WorkflowInboxController,
    WorkflowBoardController,
    WorkGroupsController,
    DocumentFilesController,
  ],
  providers: [
    WorkGroupsService,
    WorkflowDefinitionsService,
    WorkflowSimulatorService,
    WorkflowInstancesService,
    WorkflowMetricsService,
    WorkflowFilesService,
    WorkflowCommentsService,
    WorkflowInboxService,
    WorkflowBoardService,
    WorkflowPublicLinksService,
    WorkflowEmailService,
    WorkflowLoaderService,
    WorkflowEventsService,
    WorkflowReferenceService,
    WorkflowAssignmentService,
    WorkflowStageService,
    WorkflowAdvanceService,
    WorkflowStartService,
    WorkflowCompleteService,
    WorkflowTickService,
    WorkflowEngineService,
    WorkflowOutboxDispatcher,
    WorkflowTimersCron,
    {
      provide: WorkflowRequirementsService,
      useClass: DossierWorkflowRequirementsService,
    },
  ],
  exports: [
    WorkflowEngineService,
    WorkGroupsService,
    WorkflowRequirementsService,
    WorkflowMetricsService,
  ],
})
export class WorkflowsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly definitions: WorkflowDefinitionsService,
    private readonly instances: WorkflowInstancesService,
    private readonly metrics: WorkflowMetricsService,
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  /**
   * Block 11 — AI tools (propose → confirm → execute; they never publish).
   * Decentralized registration in the owning module, like the other domains.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createWorkflowsTools({
        definitions: this.definitions,
        instances: this.instances,
        metrics: this.metrics,
        findInstanceIdByReference: async (reference) => {
          const store_id = RequestContextService.getContext()?.store_id;
          if (!store_id) return null;
          const row = await this.prisma.workflow_instances.findFirst({
            where: {
              store_id,
              reference: { equals: reference, mode: 'insensitive' },
            },
            select: { id: true },
          });
          return row?.id ?? null;
        },
        storeTimezone: (store_id) =>
          resolveStoreTimezone(this.prisma, store_id),
        storeIndustries: async (store_id) => {
          const store = await this.globalPrisma.stores.findUnique({
            where: { id: store_id },
            select: { industries: true },
          });
          return store?.industries ?? null;
        },
      }),
    );
  }
}
