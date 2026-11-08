import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/index';
import { ReportExportService } from '../../../reports/services/report-export.service';
import { WorkflowSummariesList, WorkflowSummary } from '../../interfaces/workflow-insights.interfaces';
import { WorkflowInsightsApiService } from '../../services/workflow-insights-api.service';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { AnalyticsPageComponent } from './analytics-page.component';

function summary(overrides: Partial<WorkflowSummary>): WorkflowSummary {
  return {
    id: 2,
    kind: 'weekly',
    status: 'ready',
    period_from: '2026-10-08',
    period_to: '2026-11-07',
    week_key: '2026-W45',
    content: {
      headline: 'Titular',
      summary: 'Resumen',
      flows: [
        { key: 'pqr', definition_id: 7, name: 'PQR', text: 'La revisión del gerente tarda.' },
        { key: 'compras', definition_id: 8, name: 'Compras', text: 'Todo fluye.' },
      ],
      recommendations: [],
    },
    tokens_used: 10,
    model: null,
    error: null,
    created_at: '2026-11-07T13:00:00Z',
    ...overrides,
  };
}

describe('AnalyticsPageComponent — lectura de la IA', () => {
  let fixture: ComponentFixture<AnalyticsPageComponent>;
  let listResult: () => Observable<WorkflowSummariesList>;

  const q = (selector: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(AnalyticsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    listResult = () => of({ items: [summary({})], can_generate: true, next_generate_at: null });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: '7' })) } },
        {
          provide: WorkflowsApiService,
          useValue: { getDefinition: () => NEVER, getAnalytics: () => NEVER },
        },
        { provide: WorkflowInsightsApiService, useValue: { listSummaries: () => listResult() } },
        { provide: ToastService, useValue: { error: () => undefined } },
        { provide: ReportExportService, useValue: { downloadBlob: () => undefined } },
      ],
    });
  });

  it('muestra el párrafo de ESTE flujo, su periodo y el enlace a Analítica IA', async () => {
    await render();
    expect(q('[data-testid="ai-reading-text"]')?.textContent).toContain('La revisión del gerente tarda.');
    expect(q('[data-testid="ai-reading-text"]')?.textContent).not.toContain('Todo fluye.');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('del 8 de octubre al 7 de noviembre');
    expect(q('[data-testid="ai-reading-link"]')?.getAttribute('href')).toBe('/admin/workflows/insights');
  });

  it('si el flujo no está en el resumen muestra el estado vacío con el enlace', async () => {
    listResult = () =>
      of({
        items: [summary({ content: { headline: 'h', summary: 's', flows: [], recommendations: [] } })],
        can_generate: true,
        next_generate_at: null,
      });
    await render();
    expect(q('[data-testid="ai-reading-empty"]')).not.toBeNull();
    expect(q('[data-testid="ai-reading-link"]')).not.toBeNull();
  });

  it('sin resúmenes muestra el estado vacío', async () => {
    listResult = () => of({ items: [], can_generate: true, next_generate_at: null });
    await render();
    expect(q('[data-testid="ai-reading-empty"]')).not.toBeNull();
  });

  it('si falla la carga lo dice y deja el enlace', async () => {
    listResult = () => throwError(() => new Error('fallo'));
    await render();
    expect(q('[data-testid="ai-reading-error"]')).not.toBeNull();
    expect(q('[data-testid="ai-reading-link"]')).not.toBeNull();
  });
});
