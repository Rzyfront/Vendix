import { Module, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../../../common/audit/audit.service';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { createCrmCustomerTools } from '../../../../ai-engine/tools/domains/crm-customers.tools';
import { createCrmTagTools } from '../../../../ai-engine/tools/domains/crm-tags.tools';
import { createCrmSegmentTools } from '../../../../ai-engine/tools/domains/crm-segments.tools';
import { createCrmPipelineTools } from '../../../../ai-engine/tools/domains/crm-pipeline.tools';
import { createCrmTaskCampaignTools } from '../../../../ai-engine/tools/domains/crm-tasks-campaigns.tools';
import { CustomersService } from '../customers.service';
import { ResponseModule } from '../../../../common/responses/response.module';
import { StoreBootstrapHelper } from '../../../../common/helpers/store-bootstrap.helper';
import { CustomersModule } from '../customers.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { S3Module } from '../../../../common/services/s3.module';
import { DataCollectionModule } from '../../data-collection/data-collection.module';
import { CustomerDataSheetController } from './data-sheet/customer-data-sheet.controller';
import { CustomerDataSheetService } from './data-sheet/customer-data-sheet.service';
import { CustomerCrmController } from './profile/customer-crm.controller';
import { CustomerCrmService } from './profile/customer-crm.service';
import { CrmTagsController } from './tags/crm-tags.controller';
import { CrmTagsService } from './tags/crm-tags.service';
import { CrmTasksController } from './tasks/crm-tasks.controller';
import { CrmTasksService } from './tasks/crm-tasks.service';
import { CrmTaskReminderSource } from './tasks/crm-task-reminders.source';
import { ReminderSourceRegistry } from '../../notifications/reminders/reminder-source.registry';
import { CrmPipelineController } from './pipeline/crm-pipeline.controller';
import { CrmPipelineService } from './pipeline/crm-pipeline.service';
import { CrmStageTemplatesService } from './pipeline/crm-stage-templates.service';
import { CrmQuotationListener } from './pipeline/crm-quotation.listener';
import { CrmSegmentsController } from './segments/crm-segments.controller';
import { CrmSegmentsService } from './segments/crm-segments.service';
import { CrmSegmentQueryService } from './segments/crm-segment-query.service';
import { CrmSegmentMembersService } from './segments/crm-segment-members.service';
import { CrmMembershipsController } from './segments/crm-memberships.controller';
import { CrmCampaignsController } from './campaigns/crm-campaigns.controller';
import { CrmCampaignsService } from './campaigns/crm-campaigns.service';
import { CrmCampaignDispatcher } from './campaigns/crm-campaign.dispatcher';
import { CrmUnsubscribeController } from './campaigns/crm-unsubscribe.controller';
import { CrmUnsubscribeService } from './campaigns/crm-unsubscribe.service';

/**
 * Customer 360, tags, tasks, sales pipeline, segments and campaigns of the
 * store CRM (PLAN-CRM §4.4-§4.7). The inbox is `CrmInboxModule`.
 * `RedisModule`, `AuditModule`, `MessagingModule` and the Prisma services
 * are global.
 */
@Module({
  imports: [
    ResponseModule,
    CustomersModule,
    NotificationsModule,
    S3Module,
    DataCollectionModule,
  ],
  controllers: [
    CustomerCrmController,
    CustomerDataSheetController,
    CrmTagsController,
    CrmTasksController,
    CrmPipelineController,
    CrmSegmentsController,
    CrmMembershipsController,
    CrmCampaignsController,
    CrmUnsubscribeController,
  ],
  providers: [
    CustomerCrmService,
    CrmTagsService,
    CrmTasksService,
    // Recordatorios de tareas (por vencer, vencida, escalamiento, resumen):
    // los dispara el motor común `ScheduledRemindersJob`.
    CrmTaskReminderSource,
    CrmPipelineService,
    CrmStageTemplatesService,
    CustomerDataSheetService,
    CrmQuotationListener,
    CrmSegmentQueryService,
    CrmSegmentsService,
    CrmSegmentMembersService,
    CrmCampaignsService,
    CrmCampaignDispatcher,
    CrmUnsubscribeService,
    StoreBootstrapHelper,
  ],
  // Flujos (bloque 13): la acción `vendix.crm_task.create` crea tareas por aquí.
  // CustomerCrmService: the Flujos action "asignar etiqueta" uses setTags.
  // CrmSegmentQueryService: el listado de clientes (CustomersController) filtra
  // por segmento con la MISMA evaluacion de reglas que campanas y segmentos.
  exports: [CrmTasksService, CustomerCrmService, CrmSegmentQueryService],
})
export class CustomerCrmModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly auditService: AuditService,
    private readonly customersService: CustomersService,
    private readonly customerCrmService: CustomerCrmService,
    private readonly crmTagsService: CrmTagsService,
    private readonly crmTasksService: CrmTasksService,
    private readonly crmPipelineService: CrmPipelineService,
    private readonly crmSegmentsService: CrmSegmentsService,
    private readonly segmentQueryService: CrmSegmentQueryService,
    private readonly segmentMembersService: CrmSegmentMembersService,
    private readonly crmCampaignsService: CrmCampaignsService,
    private readonly reminderSources: ReminderSourceRegistry,
    private readonly crmTaskReminderSource: CrmTaskReminderSource,
  ) {}

  /**
   * QUI-1042: CRM tool family for Vex and Vexi (customer card, archive,
   * owner, notes, tags, segments, pipeline, tasks, campaigns, bulk actions).
   * Registered here because this module owns the CRM services; the
   * `AIToolRegistry` comes from the `@Global()` engine module, so no new
   * module edge is created (same pattern as `CustomersModule`).
   */
  onModuleInit(): void {
    this.reminderSources.register(this.crmTaskReminderSource);
    const { auditService, customersService } = this;
    this.toolRegistry.registerMany([
      ...createCrmCustomerTools({
        customersService,
        customerCrmService: this.customerCrmService,
        segmentMembersService: this.segmentMembersService,
        auditService,
      }),
      ...createCrmTagTools({
        crmTagsService: this.crmTagsService,
        customerCrmService: this.customerCrmService,
        segmentMembersService: this.segmentMembersService,
        customersService,
        auditService,
      }),
      ...createCrmSegmentTools({
        crmSegmentsService: this.crmSegmentsService,
        segmentQueryService: this.segmentQueryService,
        segmentMembersService: this.segmentMembersService,
        customersService,
        auditService,
      }),
      ...createCrmPipelineTools({
        crmPipelineService: this.crmPipelineService,
        customersService,
        auditService,
      }),
      ...createCrmTaskCampaignTools({
        crmTasksService: this.crmTasksService,
        crmCampaignsService: this.crmCampaignsService,
        crmSegmentsService: this.crmSegmentsService,
        customersService,
        auditService,
      }),
    ]);
  }
}
