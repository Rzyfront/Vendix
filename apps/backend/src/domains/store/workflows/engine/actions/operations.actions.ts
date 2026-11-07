import { Injectable } from '@nestjs/common';
import {
  WorkflowActionGroup,
  WorkflowActionHandlerMap,
} from './workflow-action.types';

/** Vendix actions of the registry (P1.2): gastos, compras, pagos, inventario, facturación y ventas. */
@Injectable()
export class WorkflowOperationsActions implements WorkflowActionGroup {
  readonly handlers: WorkflowActionHandlerMap = {};
}
