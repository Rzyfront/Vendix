import { WorkflowSummary } from '../interfaces/workflow-insights.interfaces';
import {
  flowParagraph,
  formatClock,
  formatDay,
  formatPeriod,
  formatTokens,
  lastMonths,
} from './workflow-insights.util';

function summary(partial: Partial<WorkflowSummary>): WorkflowSummary {
  return {
    id: 1,
    kind: 'weekly',
    status: 'ready',
    period_from: '2026-10-08',
    period_to: '2026-11-07',
    week_key: '2026-W45',
    content: { headline: 'Titular', summary: 'Resumen', flows: [], recommendations: [] },
    tokens_used: 10,
    model: null,
    error: null,
    created_at: '2026-11-07T13:00:00Z',
    ...partial,
  };
}

describe('workflow-insights.util', () => {
  it('formatea los tokens en es-CO', () => {
    expect(formatTokens(1234567)).toBe('1.234.567');
  });

  it('formatea el periodo sin correr el día', () => {
    expect(formatDay('2026-11-01')).toBe('1 de noviembre');
    expect(formatPeriod('2026-10-08', '2026-11-07')).toBe('del 8 de octubre al 7 de noviembre');
  });

  it('formatea la hora en 24 h con minutos', () => {
    expect(formatClock('2026-11-07T10:05:00')).toMatch(/^10[:.]05$/);
  });

  it('lista los últimos 12 meses, el actual primero y cruzando de año', () => {
    const months = lastMonths(12, new Date(2026, 1, 15));
    expect(months.length).toBe(12);
    expect(months[0].value).toBe('2026-02');
    expect(months[2].value).toBe('2025-12');
    expect(months[11].value).toBe('2025-03');
    expect(months[0].label).toBe('febrero de 2026');
  });

  it('toma el párrafo del flujo del último resumen listo', () => {
    const failed = summary({ id: 3, status: 'failed', content: null, error: 'x' });
    const ready = summary({
      id: 2,
      content: {
        headline: 'h',
        summary: 's',
        flows: [
          { key: 'a', definition_id: 7, name: 'PQR', text: 'Se traba en revisión' },
          { key: 'b', definition_id: 8, name: 'Compras', text: 'Todo fluye' },
        ],
        recommendations: [],
      },
    });
    const found = flowParagraph([failed, ready, summary({ id: 1 })], 7);
    expect(found?.text).toBe('Se traba en revisión');
    expect(found?.summary.id).toBe(2);
    expect(flowParagraph([failed, ready], 99)).toBeNull();
    expect(flowParagraph([], 7)).toBeNull();
  });
});
