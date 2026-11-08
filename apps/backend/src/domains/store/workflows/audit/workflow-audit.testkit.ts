import { buildWorkflowKit } from '../../../../testing/workflows/workflow-test-kit';
import { WorkflowAuditRow, WorkflowAuditService } from './workflow-audit.service';

/**
 * The shared engine kit, with a real `WorkflowAuditService` plugged into the
 * services that write audit rows. The kit builds them by position and does
 * not pass the audit service (it is optional in their constructors), so the
 * audit specs set it on the built instances.
 */
export function buildAuditedWorkflowKit() {
  const kit = buildWorkflowKit();
  const audit = new WorkflowAuditService(kit.prisma);
  const engine = kit.engine as unknown as { completer: object };
  Object.assign(kit.engine, { audit });
  Object.assign(engine.completer, { audit });
  Object.assign(kit.workflowFiles, { audit });
  const rows = () => kit.db.table('workflow_audit_log') as WorkflowAuditRow[];
  return { kit, audit, rows };
}
