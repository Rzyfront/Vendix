import type { ReportWorkbookInput } from '@common/reports/report-column.types';
import { localCivil } from '@common/utils/store-timezone.util';
import type { WorkflowAuditItem } from './workflow-audit.query';
import type { WorkflowAuditVerification } from './workflow-audit.service';

export const WORKFLOW_AUDIT_ALGORITHM_TEXT = 'SHA-256 del hash anterior + contenido canónico';

export interface WorkflowAuditWorkbookInput {
  rows: WorkflowAuditItem[];
  verification: WorkflowAuditVerification;
  store_name: string;
  timezone: string;
  generated_at: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Store-local `dd/mm/yyyy HH:mm:ss` of an instant (the `date` column type carries no time). */
export function auditLocalDateTime(iso: string | Date, tz: string): string {
  const p = localCivil(new Date(iso), tz);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function auditVerificationText(v: WorkflowAuditVerification): string {
  return v.valid
    ? `Cadena íntegra: ${v.count} registros verificados`
    : `La cadena se rompe en el registro #${v.broken_at_seq}`;
}

/** Workbook built from the same rows the screen lists, plus the integrity sheet. */
export function buildWorkflowAuditWorkbook(input: WorkflowAuditWorkbookInput): ReportWorkbookInput {
  const { rows, verification: v, timezone: tz } = input;
  return {
    sheets: [
      {
        name: 'Registros',
        tz,
        columns: [
          { key: 'seq', header: 'N.º', type: 'text', width: 10 },
          { key: 'date', header: 'Fecha', type: 'text', width: 20 },
          { key: 'category', header: 'Categoría', type: 'text', width: 16 },
          { key: 'action', header: 'Acción', type: 'text', width: 34 },
          { key: 'action_key', header: 'Clave de la acción', type: 'text', width: 30 },
          { key: 'actor', header: 'Actor', type: 'text', width: 26 },
          { key: 'ip', header: 'IP', type: 'text', width: 16 },
          { key: 'user_agent', header: 'Navegador', type: 'text', width: 36 },
          { key: 'target', header: 'Objeto', type: 'text', width: 26 },
          { key: 'summary', header: 'Resumen', type: 'text', width: 60 },
          { key: 'details', header: 'Detalles (JSON)', type: 'text', width: 50 },
          { key: 'prev_hash', header: 'Hash anterior', type: 'text', width: 66 },
          { key: 'hash', header: 'Hash', type: 'text', width: 66 },
        ],
        rows: rows.map((r) => ({
          seq: r.seq,
          date: auditLocalDateTime(r.created_at, tz),
          category: r.category_label,
          action: r.action_label,
          action_key: r.action,
          actor: r.actor.name,
          ip: r.ip_address ?? '',
          user_agent: r.user_agent ?? '',
          target: r.target.id ? `${r.target.type_label} #${r.target.id}` : r.target.type_label,
          summary: r.summary,
          details: JSON.stringify(r.details ?? {}),
          prev_hash: r.prev_hash ?? '',
          hash: r.entry_hash,
        })),
      },
      {
        name: 'Verificación',
        tz,
        columns: [
          { key: 'item', header: 'Dato', type: 'text', width: 34 },
          { key: 'value', header: 'Valor', type: 'text', width: 80 },
        ],
        rows: [
          { item: 'Resultado', value: auditVerificationText(v) },
          { item: 'Cadena íntegra', value: v.valid ? 'Sí' : 'No' },
          { item: 'Registro donde se rompe', value: v.broken_at_seq ?? '' },
          { item: 'Registros de la cadena', value: String(v.count) },
          { item: 'Registros en este archivo', value: String(rows.length) },
          { item: 'Último hash', value: v.last_hash ?? '' },
          { item: 'Algoritmo', value: WORKFLOW_AUDIT_ALGORITHM_TEXT },
          { item: 'Tienda', value: input.store_name },
          { item: 'Zona horaria', value: tz },
          { item: 'Generado', value: auditLocalDateTime(input.generated_at, tz) },
        ],
      },
    ],
  };
}
