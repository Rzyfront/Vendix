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
import { CustomerCrmModule } from '../customers/crm/customer-crm.module';
import { PurchaseOrdersModule } from '../orders/purchase-orders/purchase-orders.module';
import { EncryptionService } from '../../../common/services/encryption.service';
import { WorkflowActionsExecutor } from './engine/workflow-actions.executor';
import { WorkflowTriggerFanout } from './engine/workflow-trigger.fanout';
import { WorkflowWebhookDeliveryService } from './webhooks/workflow-webhook-delivery.service';
import { WorkflowWebhookEmitter } from './webhooks/workflow-webhook-emitter.service';
import { WorkflowWebhooksController } from './webhooks/workflow-webhooks.controller';
import { WorkflowWebhooksService } from './webhooks/workflow-webhooks.service';
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
import { WorkflowScheduleCron } from './engine/workflow-schedule.cron';
import { WorkflowMigrationService } from './definitions/workflow-migration.service';
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
import { WorkflowAnalyticsService } from './metrics/workflow-analytics.service';
import { WorkflowAnalyticsController } from './metrics/workflow-analytics.controller';
import { WorkflowTasksController } from './tasks/workflow-tasks.controller';
import { WorkflowPeopleActions } from './engine/actions/people.actions';
import { WorkflowPurchasingActions } from './engine/actions/purchasing.actions';
import { WorkflowOperationsActions } from './engine/actions/operations.actions';
import { ApprovalGateProcessor } from './gates/approval-gate.processor';
import { WorkflowLinksController } from './links/workflow-links.controller';
import { WorkflowLinksService } from './links/workflow-links.service';
import { ExpensesModule } from '../expenses/expenses.module';
import { AccountsPayableModule } from '../accounts-payable/accounts-payable.module';
import { CustomersModule } from '../customers/customers.module';
import { SuppliersModule } from '../inventory/suppliers/suppliers.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { InventoryAdjustmentsModule } from '../inventory/adjustments/inventory-adjustments.module';
import { StockTransfersModule } from '../orders/stock-transfers/stock-transfers.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { InvoiceDeliveryModule } from '../invoicing/delivery/invoice-delivery.module';
import { OrderFlowModule } from '../orders/order-flow/order-flow.module';
import { OrdersModule } from '../orders/orders.module';

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
    // Bloque 13 / P1.2: acciones Vendix por los mismos servicios de la UI.
    // P1.3: los mismos servicios aplican el efecto de un candado resuelto.
    PurchaseOrdersModule,
    CustomerCrmModule,
    ExpensesModule,
    AccountsPayableModule,
    CustomersModule,
    SuppliersModule,
    PayrollModule,
    ReservationsModule,
    InventoryAdjustmentsModule,
    StockTransfersModule,
    InvoicingModule,
    InvoiceDeliveryModule,
    OrderFlowModule,
    OrdersModule,
  ],
  controllers: [
    WorkflowDefinitionsController,
    WorkflowInstancesController,
    WorkflowTasksController,
    WorkflowInboxController,
    WorkflowBoardController,
    WorkflowAnalyticsController,
    WorkGroupsController,
    DocumentFilesController,
    WorkflowWebhooksController,
    WorkflowLinksController,
  ],
  providers: [
    WorkGroupsService,
    WorkflowDefinitionsService,
    WorkflowSimulatorService,
    WorkflowMigrationService,
    WorkflowInstancesService,
    WorkflowMetricsService,
    WorkflowAnalyticsService,
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
    WorkflowScheduleCron,
    // Bloque 13: webhooks salientes, disparadores por evento y acciones Vendix.
    EncryptionService,
    WorkflowWebhookEmitter,
    WorkflowWebhookDeliveryService,
    WorkflowWebhooksService,
    WorkflowTriggerFanout,
    WorkflowActionsExecutor,
    // P1.2: registro de acciones; P1.3: candado de aprobación; P1.4: vínculos.
    WorkflowPeopleActions,
    WorkflowPurchasingActions,
    WorkflowOperationsActions,
    ApprovalGateProcessor,
    WorkflowLinksService,
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
    // Reused by the `/api/v1/workflows` API-key surface (domains/api-v1).
    WorkflowDefinitionsService,
    WorkflowInstancesService,
    WorkflowInboxService,
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
