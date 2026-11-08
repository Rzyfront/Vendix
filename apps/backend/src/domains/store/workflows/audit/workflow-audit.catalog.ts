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

/** Spanish label of every action, as the screen and the XLSX export show it. */
export const WORKFLOW_AUDIT_ACTION_LABELS: Record<WorkflowAuditAction, string> = {
  'definition.created': 'Flujo creado',
  'definition.draft_saved': 'Borrador guardado',
  'definition.published': 'Flujo publicado',
  'definition.imported': 'Flujo importado',
  'definition.exported': 'Flujo exportado',
  'definition.enabled': 'Flujo activado',
  'definition.disabled': 'Flujo desactivado',
  'definition.archived': 'Flujo archivado',
  'definition.unarchived': 'Flujo restaurado',
  'definition.access_changed': 'Permisos del flujo cambiados',
  'definition.instances_migrated': 'Solicitudes migradas a otra versión',
  'decision.task_completed': 'Tarea decidida',
  'decision.task_voted': 'Voto registrado',
  'decision.instance_cancelled': 'Solicitud cancelada',
  'decision.instance_forced': 'Solicitud movida a la fuerza',
  'document.file_downloaded': 'Archivo descargado',
  'document.sealed_downloaded': 'Documento firmado descargado',
  'document.issued_downloaded': 'Documento emitido descargado',
  'document.public_file_downloaded': 'Documento abierto por una persona externa',
  'secret.created': 'Secreto creado',
  'secret.updated': 'Secreto actualizado',
  'secret.deleted': 'Secreto eliminado',
  'secret.used': 'Secreto usado en una llamada',
  'export.requested': 'Exportación solicitada',
  'export.downloaded': 'Exportación descargada',
  'audit.exported': 'Auditoría exportada',
};

/** Spanish name of the kind of object a row points at (`target_type`). */
export const WORKFLOW_AUDIT_TARGET_LABELS: Record<string, string> = {
  definition: 'Flujo',
  instance: 'Solicitud',
  task: 'Tarea',
  file: 'Archivo',
  issued_document: 'Documento emitido',
  signature_request: 'Solicitud de firma',
  record: 'Registro',
  secret: 'Secreto',
  export: 'Exportación',
  audit: 'Auditoría',
};
