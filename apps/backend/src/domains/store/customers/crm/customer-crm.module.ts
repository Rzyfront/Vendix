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

/**
 * Customer 360, tags, tasks and sales pipeline of the store CRM
 * (PLAN-CRM §4.4-§4.6). The inbox is `CrmInboxModule`. `RedisModule`,
 * `AuditModule` and the Prisma services are global.
 */
@Module({
  imports: [ResponseModule, CustomersModule, NotificationsModule],
  controllers: [
    CustomerCrmController,
    CrmTagsController,
    CrmTasksController,
    CrmPipelineController,
  ],
  providers: [
    CustomerCrmService,
    CrmTagsService,
    CrmTasksService,
    CrmTaskDueJob,
    CrmPipelineService,
    CrmQuotationListener,
    StoreBootstrapHelper,
  ],
})
export class CustomerCrmModule {}
