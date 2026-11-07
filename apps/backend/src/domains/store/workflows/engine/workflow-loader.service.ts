import { ForbiddenException, Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
  findStage,
} from '@common/workflows/contract';
import {
  WorkflowInstanceRow,
  WorkflowTaskRow,
  WorkflowTx,
} from './workflow-engine.types';

export interface WorkflowCallContext {
  store_id: number;
  organization_id: number;
  user_id: number | null;
  is_owner: boolean;
  is_super_admin: boolean;
  permissions: string[];
}

/** Reads shared by the engine commands. Every read is store scoped. */
@Injectable()
export class WorkflowLoaderService {
  context(): WorkflowCallContext {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new ForbiddenException('Acceso denegado: falta el contexto de tienda');
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id ?? null,
      is_owner: !!c.is_owner,
      is_super_admin: !!c.is_super_admin,
      permissions: c.permissions ?? [],
    };
  }

  async loadInstance(tx: WorkflowTx, id: number): Promise<WorkflowInstanceRow> {
    const row = await tx.workflow_instances.findFirst({
      where: { id, store_id: this.context().store_id },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    return row as WorkflowInstanceRow;
  }

  async loadTask(tx: WorkflowTx, id: number): Promise<WorkflowTaskRow> {
    const row = await tx.workflow_tasks.findFirst({
      where: { id, store_id: this.context().store_id },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_NOT_FOUND);
    return row as WorkflowTaskRow;
  }

  async loadDefinition(
    tx: WorkflowTx,
    versionId: number,
  ): Promise<WorkflowDefinitionV1> {
    const v = await tx.workflow_versions.findFirst({
      where: { id: versionId, store_id: this.context().store_id },
    });
    if (!v) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    return v.definition as WorkflowDefinitionV1;
  }

  /** Current stage of the instance; a missing stage is a corrupt definition. */
  currentStage(
    definition: WorkflowDefinitionV1,
    instance: Pick<WorkflowInstanceRow, 'current_stage_key'>,
  ): WorkflowStageDef {
    const stage = findStage(definition, instance.current_stage_key);
    if (!stage) throw new VendixHttpException(ErrorCodes.WORKFLOW_STAGE_NOT_FOUND);
    return stage;
  }
}
