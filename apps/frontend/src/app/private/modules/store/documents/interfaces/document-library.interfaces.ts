/** Types of the document library: search, folders, expiry and retention (P4.4/P4.6/P4.7). */

export interface FileProfile {
  file_id: number;
  doc_type: string | null;
  tags: string[];
  /** `YYYY-MM-DD` or null. */
  valid_until: string | null;
  legal_hold: boolean;
}

export interface UpdateFileProfileBody {
  doc_type?: string | null;
  tags?: string[];
  valid_until?: string | null;
}

export interface SubjectRef {
  type: string;
  id: number;
  label: string;
  collection_key: string | null;
  collection_name: string | null;
}

export interface LibraryFile {
  id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number | string;
  created_at: string;
  legal_hold: boolean;
  doc_type: string | null;
  tags: string[];
  valid_until: string | null;
  dossier: { id: number; reference: string; title: string } | null;
  subject: SubjectRef | null;
  request: { id: number; reference: string | null; title: string | null } | null;
}

export interface SearchQuery {
  q?: string;
  doc_type?: string;
  tag?: string;
  subject_type?: string;
  subject_id?: number;
  page?: number;
  limit?: number;
}

export interface FolderGroup {
  subject_type: string;
  collection_key: string | null;
  collection_name: string | null;
  entities: number;
  dossiers: number;
  files: number;
}

export interface FolderEntity extends SubjectRef {
  subject_type: string;
  dossiers: number;
  files: number;
}

export interface FolderFilesResult {
  subject: SubjectRef;
  dossiers: Array<{
    id: number;
    reference: string;
    title: string;
    workflow_instance_id: number | null;
    closed_at: string | null;
    created_at: string;
  }>;
  data: LibraryFile[];
  total: number;
  page: number;
  limit: number;
}

export interface ExpiringRow {
  file_id: number;
  file_name: string;
  legal_hold: boolean;
  doc_type: string | null;
  tags: string[];
  valid_until: string;
  /** Negative once expired. */
  days_left: number;
  dossier: { id: number; reference: string; title: string } | null;
  subject_type: string | null;
  subject_id: number | null;
  renewal: { id: number; reference: string; title: string; status: string } | null;
}

export interface RetentionPolicy {
  id: number;
  key: string;
  name: string;
  subject_type: string | null;
  doc_type: string | null;
  retain_days: number;
  is_active: boolean;
}

export interface RetentionPolicyBody {
  name: string;
  subject_type: string | null;
  doc_type: string | null;
  retain_days: number;
  is_active: boolean;
}

export interface PurgeCandidateView {
  file_id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  dossier_id: number;
  dossier_reference: string;
  subject_type: string | null;
  closed_at: string;
  policy_id: number;
  policy_name: string;
  retain_days: number;
  due_at: string;
  legal_hold: boolean;
  reason: string;
}

export interface PurgePreview {
  to_purge: PurgeCandidateView[];
  skipped_legal_hold: PurgeCandidateView[];
  totals: { files: number; bytes: number; skipped_legal_hold: number };
}

export interface PurgeRun {
  id: number;
  trigger: 'schedule' | 'manual';
  status: string;
  files_purged: number;
  bytes_purged: number;
  skipped_legal_hold: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface PurgeRunItem {
  id: number;
  file_id: number;
  policy_id: number | null;
  /** `claimed`: the file is being purged by a run that has not finished. */
  outcome: 'purged' | 'skipped_legal_hold' | 'claimed';
  original_name: string;
  size_bytes: number;
  sha256: string;
  reason: string;
  created_at: string;
}

export interface PurgeRunDetail extends PurgeRun {
  items: PurgeRunItem[];
}

/** File of a dossier as the documents page lists it (purge state included). */
export interface DossierFileItem {
  id: number;
  kind: string;
  requirement_key: string | null;
  field_key: string | null;
  status: string;
  created_at: string;
  file: {
    id: number;
    original_name: string;
    mime_type: string;
    size_bytes: number | string;
    sha256: string;
    purged_at?: string | null;
    purge_policy_name?: string | null;
  } | null;
}

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  customer: 'Clientes',
  supplier: 'Proveedores',
  employee: 'Empleados',
  order: 'Ventas',
  purchase_order: 'Órdenes de compra',
  expense: 'Gastos',
  invoice: 'Facturas',
  payroll_run: 'Períodos de nómina',
  custom_record: 'Registros personalizados',
};

const SUBJECT_TYPE_SINGULAR: Record<string, string> = {
  customer: 'Cliente',
  supplier: 'Proveedor',
  employee: 'Empleado',
  order: 'Venta',
  purchase_order: 'Orden de compra',
  expense: 'Gasto',
  invoice: 'Factura',
  payroll_run: 'Período de nómina',
  custom_record: 'Registro personalizado',
};

/** Options for the "sujeto" selectors (retention policies). */
export const SUBJECT_TYPE_OPTIONS: Array<{ value: string; label: string }> = Object.entries(
  SUBJECT_TYPE_SINGULAR,
).map(([value, label]) => ({ value, label }));

/** Plural folder name; a custom collection shows its own name. */
export function folderLabel(type: string, collectionName?: string | null): string {
  if (type === 'custom_record' && collectionName) return collectionName;
  return SUBJECT_TYPE_LABELS[type] ?? type;
}

export function subjectSingular(type: string | null | undefined): string {
  if (!type) return 'Sin sujeto';
  return SUBJECT_TYPE_SINGULAR[type] ?? type;
}

/** "7/12/2026" from a `YYYY-MM-DD` date, without moving the day by time zone. */
export function dateOnlyText(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
}

/** "Vence en 12 días" / "Venció hace 3 días" / "Vence hoy". */
export function daysLeftText(days: number): string {
  if (days === 0) return 'Vence hoy';
  if (days > 0) return `Vence en ${days} ${days === 1 ? 'día' : 'días'}`;
  const ago = Math.abs(days);
  return `Venció hace ${ago} ${ago === 1 ? 'día' : 'días'}`;
}
