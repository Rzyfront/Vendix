import { Injectable } from '@nestjs/common';
import {
  WorkflowActionGroup,
  WorkflowActionHandlerMap,
} from './workflow-action.types';

/** Vendix actions of the registry (P1.2): clientes, proveedores, empleados, etiquetas, tareas CRM y reservas. */
@Injectable()
export class WorkflowPeopleActions implements WorkflowActionGroup {
  readonly handlers: WorkflowActionHandlerMap = {};
}
