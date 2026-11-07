import { Injectable } from '@nestjs/common';
import {
  WORKFLOW_ACTION_CATALOG,
  WorkflowVendixActionName,
} from '@common/workflows/contract';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowHttpTestService } from '../../secrets/workflow-http-test.service';

/**
 * A "Probar" runs the real effect (it calls the service with the store's
 * secrets, it sends a paid template), so the person needs the permission the
 * action itself declares in the catalog: the same one the engine demands of
 * the publisher when the flow runs. Designing flows is not enough.
 */
export function requireActionPermission(action: WorkflowVendixActionName): void {
  const ctx = RequestContextService.getContext();
  if (ctx?.is_super_admin) return;
  const spec = WORKFLOW_ACTION_CATALOG[action];
  if (!(ctx?.permissions ?? []).includes(spec.permission)) {
    throw new VendixHttpException(
      ErrorCodes.AUTH_PERM_001,
      `Probar "${spec.label}" requiere el permiso ${spec.permission}.`,
    );
  }
}

/**
 * "Probar esta acción" of the HTTP node. The call is real and resolves the
 * store's `{{secrets.*}}`, so it requires the permission of
 * `vendix.http.request` (`store:workflows:manage`, the same one needed to
 * create those secrets) on top of the route's `store:workflows:design`.
 * Registered in the module in place of {@link WorkflowHttpTestService}.
 */
@Injectable()
export class PermissionedWorkflowHttpTestService extends WorkflowHttpTestService {
  override async test(
    ...args: Parameters<WorkflowHttpTestService['test']>
  ): Promise<Awaited<ReturnType<WorkflowHttpTestService['test']>>> {
    requireActionPermission('vendix.http.request');
    return super.test(...args);
  }
}
