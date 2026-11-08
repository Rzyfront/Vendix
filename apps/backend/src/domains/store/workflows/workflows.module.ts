import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createWorkflowsTools } from '../../../ai-engine/tools/domains/workflows.tools';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { resolveStoreTimezone } from '../../../common/utils/store-timezone.util';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
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
import { WorkflowRecordDateCron } from './engine/workflow-record-date.cron';
import { WorkflowCollectionsController } from './records/workflow-collections.controller';
import { WorkflowCollectionsService } from './records/workflow-collections.service';
import { WorkflowRecordsController } from './records/workflow-records.controller';
import { WorkflowRecordsService } from './records/workflow-records.service';
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
import { WorkflowPublicLinkController } from './public-link/workflow-public-link.controller';
import { WorkflowPublicUploadsService } from './public-link/workflow-public-uploads.service';
import { WorkflowUploadSessionsCron } from './public-link/workflow-upload-sessions.cron';
import { WorkflowTrackingController } from './tracking/workflow-tracking.controller';
import { WorkflowTrackingLinksService } from './tracking/workflow-tracking-links.service';
import { WorkflowTrackingPublicService } from './tracking/workflow-tracking-public.service';
import { WorkflowMetricsService } from './metrics/workflow-metrics.service';
import { WorkflowAnalyticsService } from './metrics/workflow-analytics.service';
import { WorkflowAiService } from './ai/workflow-ai.service';
import { WorkflowAnalyticsController } from './metrics/workflow-analytics.controller';
import { WorkflowTasksController } from './tasks/workflow-tasks.controller';
import { WorkflowPeopleActions } from './engine/actions/people.actions';
import { WorkflowPurchasingActions } from './engine/actions/purchasing.actions';
import { WorkflowOperationsActions } from './engine/actions/operations.actions';
import { WorkflowConnectorsActions } from './engine/actions/connectors.actions';
import { WorkflowDocumentSignActions } from './engine/actions/documents-sign.actions';
import { WorkflowDocumentsActions } from './engine/actions/documents-issue.actions';
import { WorkflowConnectorsController } from './connectors/connectors.controller';
import { WorkflowConnectorsService } from './connectors/connectors.service';
import { WorkflowHttpActions } from './engine/actions/http.actions';
import { WorkflowSecretsController } from './secrets/workflow-secrets.controller';
import { WorkflowSecretsService } from './secrets/workflow-secrets.service';
import { WorkflowHttpTestController } from './secrets/workflow-http-test.controller';
import { WorkflowHttpTestService } from './secrets/workflow-http-test.service';
import { PermissionedWorkflowHttpTestService } from './engine/actions/action-test-permission';
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
import { DocumentEmailMimeService } from '../../received-documents/services/document-email-mime.service';
import { WorkflowInboundController } from './inbound/workflow-inbound.controller';
import { WorkflowInboundHooksService } from './inbound/workflow-inbound-hooks.service';
import { WorkflowInboundPublicController } from './inbound/workflow-inbound-public.controller';
import { WorkflowInboundReceiverService } from './inbound/workflow-inbound-receiver.service';
import { WorkflowMailboxReceiverService } from './inbound/workflow-mailbox-receiver.service';
import { WorkflowMailboxService } from './inbound/workflow-mailbox.service';
import { WORKFLOW_MAILBOX_RECEIVER } from './inbound/workflow-mailbox.types';
import { WorkflowInstanceDebugController } from './instances/workflow-instance-debug.controller';
import { WorkflowInstanceDebugService } from './instances/workflow-instance-debug.service';
import { WorkflowActionTestController } from './definitions/workflow-action-test.controller';
import { WorkflowActionTestService } from './definitions/workflow-action-test.service';
import { WorkflowTemplatesController } from './templates/workflow-templates.controller';
import { WorkflowTemplatesService } from './templates/workflow-templates.service';
import { WorkflowLiveController } from './live/workflow-live.controller';
import { WorkflowLiveListener } from './live/workflow-live.listener';

/**
 * Flujos: motor (start / completeTask / claim / transition / cancel / tick),
 * grupos de trabajo, despachador de outbox y temporizadores. Operación (bloque 8): bandeja `inbox`, tablero `board`, comentarios, enlace público y correo.
 * Controladores (bloque 4):
 * `store/workflows/{definitions,instances,tasks}` y `store/work-groups`.
 * `WorkflowRequirementsService` se evalúa contra el expediente de la instancia (`DocumentsModule`):
 * `upload` y `file_field` por el expediente; `issued_document` / `signature` por el documento emitido vigente (P4).
 */
@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    EmailModule,
    ResponseModule,
    DocumentsModule,
    S3Module,
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
    WorkflowPublicLinkController,
    WorkflowTrackingController,
    WorkflowCollectionsController,
    WorkflowRecordsController,
    // P3.1 / P3.3: webhook de entrada y buzón por flujo (admin + público).
    WorkflowInboundController,
    WorkflowInboundPublicController,
    WorkflowSecretsController,
    WorkflowHttpTestController,
    WorkflowConnectorsController,
    // P5.2: depurador de instancias y "probar esta acción"; P5.4: galería.
    WorkflowInstanceDebugController,
    WorkflowActionTestController,
    WorkflowTemplatesController,
    // P5.6: actualización en vivo (SSE sobre NOTIFY workflow_live).
    WorkflowLiveController,
  ],
  providers: [
    WorkGroupsService,
    WorkflowInstanceDebugService,
    WorkflowActionTestService,
    WorkflowTemplatesService,
    WorkflowLiveListener,
    WorkflowDefinitionsService,
    WorkflowSimulatorService,
    WorkflowMigrationService,
    WorkflowInstancesService,
    WorkflowMetricsService,
    WorkflowAnalyticsService,
    // P6.3: single gateway for every AI call of Flows (quota, ledger, alerts).
    WorkflowAiService,
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
    // P3.6: registros personalizados y su disparador por fecha.
    WorkflowCollectionsService,
    WorkflowRecordsService,
    WorkflowRecordDateCron,
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
    // P3.2: nodo HTTP genérico con secretos de la tienda.
    WorkflowSecretsService,
    WorkflowHttpActions,
    // "Probar" del nodo HTTP: exige el permiso de la acción, no solo diseñar.
    { provide: WorkflowHttpTestService, useClass: PermissionedWorkflowHttpTestService },
    WorkflowConnectorsActions,
    // P4.2: enviar un documento emitido a firmar.
    WorkflowDocumentSignActions,
    // P4.1: emitir un documento desde una plantilla.
    WorkflowDocumentsActions,
    WorkflowConnectorsService,
    ApprovalGateProcessor,
    WorkflowLinksService,
    // P3.4 / P3.5: subida por partes, limpieza de sesiones y portal de seguimiento.
    WorkflowPublicUploadsService,
    WorkflowUploadSessionsCron,
    WorkflowTrackingLinksService,
    WorkflowTrackingPublicService,
    WorkflowInboundHooksService,
    WorkflowInboundReceiverService,
    WorkflowMailboxService,
    WorkflowMailboxReceiverService,
    // The reception consumer resolves the receiver by token (ModuleRef) to avoid a module cycle.
    { provide: WORKFLOW_MAILBOX_RECEIVER, useExisting: WorkflowMailboxReceiverService },
    // Mail attachments up to 25 MB (the document pipeline keeps its own 10 MB instance).
    {
      provide: DocumentEmailMimeService,
      useFactory: () => new DocumentEmailMimeService({ part_bytes: 25 * 1024 * 1024 }),
    },
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
    // Used by the public form and the tracking portal (`ecommerce/workflows-public`).
    WorkflowPublicUploadsService,
    WorkflowTrackingLinksService,
    WorkflowTrackingPublicService,
    // P6.3: the document read (DocumentChecksModule) records its tokens here.
    WorkflowAiService,
  ],
})
export class WorkflowsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly definitions: WorkflowDefinitionsService,
    private readonly instances: WorkflowInstancesService,
    private readonly metrics: WorkflowMetricsService,
    private readonly engine: WorkflowEngineService,
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  /**
   * Block 11 — AI tools (propose → confirm → execute; every write, publishing
   * included, runs only after the user confirms its card).
   * Decentralized registration in the owning module, like the other domains.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createWorkflowsTools({
        definitions: this.definitions,
        instances: this.instances,
        metrics: this.metrics,
        engine: this.engine,
        findInstanceIdByTaskId: async (taskId) => {
          const store_id = RequestContextService.getContext()?.store_id;
          if (!store_id) return null;
          const row = await this.prisma.workflow_tasks.findFirst({
            where: { id: taskId, store_id },
            select: { instance_id: true },
          });
          return row?.instance_id ?? null;
        },
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
