import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../../common/responses/response.module';
import { StoreBootstrapHelper } from '../../../../common/helpers/store-bootstrap.helper';
import { CustomersModule } from '../customers.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { CustomerCrmController } from './profile/customer-crm.controller';
import { CustomerCrmService } from './profile/customer-crm.service';
import { CrmTagsController } from './tags/crm-tags.controller';
import { CrmTagsService } from './tags/crm-tags.service';
import { CrmTasksController } from './tasks/crm-tasks.controller';
import { CrmTasksService } from './tasks/crm-tasks.service';
import { CrmTaskDueJob } from './tasks/crm-task-due.job';
import { CrmPipelineController } from './pipeline/crm-pipeline.controller';
import { CrmPipelineService } from './pipeline/crm-pipeline.service';
import { CrmQuotationListener } from './pipeline/crm-quotation.listener';
import { CrmSegmentsController } from './segments/crm-segments.controller';
import { CrmSegmentsService } from './segments/crm-segments.service';
import { CrmSegmentQueryService } from './segments/crm-segment-query.service';
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
  imports: [ResponseModule, CustomersModule, NotificationsModule],
  controllers: [
    CustomerCrmController,
    CrmTagsController,
    CrmTasksController,
    CrmPipelineController,
    CrmSegmentsController,
    CrmCampaignsController,
    CrmUnsubscribeController,
  ],
  providers: [
    CustomerCrmService,
    CrmTagsService,
    CrmTasksService,
    CrmTaskDueJob,
    CrmPipelineService,
    CrmQuotationListener,
    CrmSegmentQueryService,
    CrmSegmentsService,
    CrmCampaignsService,
    CrmCampaignDispatcher,
    CrmUnsubscribeService,
    StoreBootstrapHelper,
  ],
})
export class CustomerCrmModule {}
