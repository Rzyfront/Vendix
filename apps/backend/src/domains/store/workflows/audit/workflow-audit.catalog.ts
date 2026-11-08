/**
 * Closed catalog of the Flows audit trail (flujos-adm P7.2). Every action
 * belongs to exactly one category; the screen filters by category and the
 * export carries the action key, so a key never changes meaning once shipped.
 */
export const WORKFLOW_AUDIT_CATEGORIES = [
  'definition',
  'decision',
  'document',
  'secret',
  'export',
] as const;
export type WorkflowAuditCategory = (typeof WORKFLOW_AUDIT_CATEGORIES)[number];

export const WORKFLOW_AUDIT_ACTIONS = {
  // Definitions (who designs what).
  'definition.created': 'definition',
  'definition.draft_saved': 'definition',
  'definition.published': 'definition',
  'definition.imported': 'definition',
  'definition.exported': 'definition',
  'definition.enabled': 'definition',
  'definition.disabled': 'definition',
  'definition.archived': 'definition',
  'definition.unarchived': 'definition',
  'definition.access_changed': 'definition',
  'definition.instances_migrated': 'definition',
  // Decisions on requests.
  'decision.task_completed': 'decision',
  'decision.task_voted': 'decision',
  'decision.instance_cancelled': 'decision',
  'decision.instance_forced': 'decision',
  // Document accesses.
  'document.file_downloaded': 'document',
  'document.sealed_downloaded': 'document',
  'document.issued_downloaded': 'document',
  'document.public_file_downloaded': 'document',
  // Secrets (never their values).
  'secret.created': 'secret',
  'secret.updated': 'secret',
  'secret.deleted': 'secret',
  'secret.used': 'secret',
  // Data leaving the store.
  'export.requested': 'export',
  'export.downloaded': 'export',
  'audit.exported': 'export',
} as const satisfies Record<string, WorkflowAuditCategory>;

export type WorkflowAuditAction = keyof typeof WORKFLOW_AUDIT_ACTIONS;

export type WorkflowAuditActorType = 'user' | 'system' | 'public' | 'external';

/** Labels shown on the "Auditoría" screen and in the XLSX export. */
export const WORKFLOW_AUDIT_CATEGORY_LABELS: Record<WorkflowAuditCategory, string> = {
  definition: 'Definiciones',
  decision: 'Decisiones',
  document: 'Documentos',
  secret: 'Secretos',
  export: 'Exportaciones',
};

export function auditCategoryOf(action: WorkflowAuditAction): WorkflowAuditCategory {
  return WORKFLOW_AUDIT_ACTIONS[action];
}

export function isWorkflowAuditAction(value: unknown): value is WorkflowAuditAction {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WORKFLOW_AUDIT_ACTIONS, value);
}
