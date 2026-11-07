import type { ReportWorkbookInput } from '@common/reports/report-column.types';
import type { WorkflowAnalyticsReport } from './workflow-analytics.service';

const HOURS = '0.0';

/**
 * Workbook built FROM the dataset object the screen renders (never a second
 * query path). Hours with 1 decimal, rates as fractions with a % format.
 */
export function buildWorkflowAnalyticsWorkbook(
  report: WorkflowAnalyticsReport,
): ReportWorkbookInput {
  const tz = report.range.timezone;
  const k = report.kpis;
  const bottleneck =
    report.stages.find((s) => s.stage_key === report.bottleneck_stage_key)
      ?.name ?? null;
  return {
    sheets: [
      {
        name: 'Resumen',
        tz,
        columns: [
          { key: 'flow', header: 'Flujo', type: 'text', width: 28 },
          { key: 'from', header: 'Desde', type: 'date-only' },
          { key: 'to', header: 'Hasta', type: 'date-only' },
          { key: 'timezone', header: 'Zona horaria', type: 'text' },
          { key: 'started', header: 'Iniciadas', type: 'number', numFmt: '0' },
          {
            key: 'completed',
            header: 'Completadas',
            type: 'number',
            numFmt: '0',
          },
          {
            key: 'rejected',
            header: 'Rechazadas',
            type: 'number',
            numFmt: '0',
          },
          {
            key: 'cancelled',
            header: 'Canceladas',
            type: 'number',
            numFmt: '0',
          },
          { key: 'active', header: 'En curso', type: 'number', numFmt: '0' },
          { key: 'overdue', header: 'Vencidas', type: 'number', numFmt: '0' },
          {
            key: 'cycle_avg_hours',
            header: 'Ciclo promedio (h)',
            type: 'number',
            numFmt: HOURS,
          },
          {
            key: 'cycle_p90_hours',
            header: 'Ciclo p90 (h)',
            type: 'number',
            numFmt: HOURS,
          },
          {
            key: 'on_time_rate',
            header: '% dentro del plazo',
            type: 'percent',
          },
          {
            key: 'bottleneck',
            header: 'Cuello de botella',
            type: 'text',
            width: 28,
          },
          { key: 'insufficient', header: 'Datos insuficientes', type: 'text' },
        ],
        rows: [
          {
            flow: report.definition.name,
            from: report.range.from,
            to: report.range.to,
            timezone: tz,
            ...k,
            bottleneck,
            insufficient: report.insufficient_data ? 'Sí' : 'No',
          },
        ],
      },
      {
        name: 'Etapas',
        tz,
        columns: [
          { key: 'name', header: 'Etapa', type: 'text', width: 30 },
          { key: 'wip', header: 'En curso', type: 'number', numFmt: '0' },
          { key: 'entered', header: 'Entradas', type: 'number', numFmt: '0' },
          { key: 'exited', header: 'Salidas', type: 'number', numFmt: '0' },
          {
            key: 'avg_hours',
            header: 'Promedio (h)',
            type: 'number',
            numFmt: HOURS,
          },
          {
            key: 'p90_hours',
            header: 'p90 (h)',
            type: 'number',
            numFmt: HOURS,
          },
          {
            key: 'overdue_now',
            header: 'Vencidas ahora',
            type: 'number',
            numFmt: '0',
          },
          {
            key: 'on_time_rate',
            header: '% dentro del plazo',
            type: 'percent',
          },
          { key: 'reject_rate', header: '% rechazo', type: 'percent' },
        ],
        rows: report.stages as unknown as Record<string, unknown>[],
      },
      {
        name: 'Personas',
        tz,
        columns: [
          { key: 'name', header: 'Persona', type: 'text', width: 30 },
          {
            key: 'tasks_done',
            header: 'Tareas atendidas',
            type: 'number',
            numFmt: '0',
          },
          {
            key: 'on_time_rate',
            header: '% dentro del plazo',
            type: 'percent',
          },
          {
            key: 'avg_hours',
            header: 'Promedio (h)',
            type: 'number',
            numFmt: HOURS,
          },
        ],
        rows: report.people as unknown as Record<string, unknown>[],
      },
      {
        name: 'Diario',
        tz,
        columns: [
          { key: 'date', header: 'Día', type: 'date-only' },
          { key: 'started', header: 'Iniciadas', type: 'number', numFmt: '0' },
          {
            key: 'completed',
            header: 'Completadas',
            type: 'number',
            numFmt: '0',
          },
        ],
        rows: report.daily as unknown as Record<string, unknown>[],
      },
    ],
  };
}
