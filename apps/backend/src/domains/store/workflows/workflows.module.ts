import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DocumentsModule } from '../documents/documents.module';
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
import { WorkflowTasksController } from './tasks/workflow-tasks.controller';

/**
 * Flujos: motor (start / completeTask / claim / transition / cancel / tick),
 * grupos de trabajo, despachador de outbox y temporizadores. Controladores (bloque 4):
 * `store/workflows/{definitions,instances,tasks}` y `store/work-groups`.
 * `WorkflowRequirementsService` se evalúa contra el expediente de la instancia (`DocumentsModule`):
 * `upload` y `file_field` reales; `issued_document` / `signature` llegan en tareas documentales posteriores.
 */
@Module({
  imports: [PrismaModule, NotificationsModule, ResponseModule, DocumentsModule],
  controllers: [
    WorkflowDefinitionsController,
    WorkflowInstancesController,
    WorkflowTasksController,
    WorkGroupsController,
    DocumentFilesController,
  ],
  providers: [
    WorkGroupsService,
    WorkflowDefinitionsService,
    WorkflowSimulatorService,
    WorkflowInstancesService,
    WorkflowFilesService,
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
  exports: [WorkflowEngineService, WorkGroupsService, WorkflowRequirementsService],
})
export class WorkflowsModule {}
