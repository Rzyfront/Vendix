import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowAdvanceService } from './engine/workflow-advance.service';
import { WorkflowAssignmentService } from './engine/workflow-assignment.service';
import { WorkflowCompleteService } from './engine/workflow-complete.service';
import { WorkflowRequirementsService } from './engine/workflow-engine.types';
import { WorkflowEngineService } from './engine/workflow-engine.service';
import { WorkflowEventsService } from './engine/workflow-events.service';
import { WorkflowLoaderService } from './engine/workflow-loader.service';
import { WorkflowOutboxDispatcher } from './engine/workflow-outbox.dispatcher';
import { WorkflowReferenceService } from './engine/workflow-reference.service';
import { DefaultWorkflowRequirementsService } from './engine/workflow-requirements.service';
import { WorkflowStageService } from './engine/workflow-stage.service';
import { WorkflowStartService } from './engine/workflow-start.service';
import { WorkflowTickService } from './engine/workflow-tick.service';
import { WorkflowTimersCron } from './engine/workflow-timers.cron';
import { WorkGroupsService } from './work-groups.service';

/**
 * Flujos: motor (start / completeTask / claim / transition / cancel / tick),
 * grupos de trabajo, despachador de outbox y temporizadores. Los controladores
 * llegan en el bloque 4. `WorkflowRequirementsService` es el punto de enchufe
 * del bloque documental (upload / issued_document / signature).
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [
    WorkGroupsService,
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
      useClass: DefaultWorkflowRequirementsService,
    },
  ],
  exports: [WorkflowEngineService, WorkGroupsService, WorkflowRequirementsService],
})
export class WorkflowsModule {}
