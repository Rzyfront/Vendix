import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  WorkflowAiQuota,
  WorkflowAiUsage,
  WorkflowSummariesList,
  WorkflowSummary,
} from '../../interfaces/workflow-insights.interfaces';
import { WorkflowInsightsApiService } from '../../services/workflow-insights-api.service';
import { lastMonths } from '../../utils/workflow-insights.util';
import { InsightsPageComponent } from './insights-page.component';

function usage(quota: WorkflowAiQuota | null, overrides: Partial<WorkflowAiUsage> = {}): WorkflowAiUsage {
  return {
    month: '2026-11',
    quota,
    flows_tokens: 5400,
    calls: 6,
    skipped: 0,
    by_flow: [
      { definition_id: 7, name: 'PQR', calls: 4, tokens: 4000 },
      { definition_id: null, name: 'Sin flujo', calls: 2, tokens: 1400 },
    ],
    by_purpose: [
      { purpose: 'ai_step', calls: 4, tokens: 4000 },
      { purpose: 'ai_step_test', calls: 1, tokens: 400 },
      { purpose: 'document_read', calls: 0, tokens: 0 },
      { purpose: 'insights_summary', calls: 1, tokens: 1000 },
    ],
    ...overrides,
  };
}

function quota(overrides: Partial<WorkflowAiQuota>): WorkflowAiQuota {
  return { state: 'ok', used: 40000, cap: 100000, percent: 40, period: '2026-11', reason: null, ...overrides };
}

function summary(overrides: Partial<WorkflowSummary>): WorkflowSummary {
  return {
    id: 2,
    kind: 'weekly',
    status: 'ready',
    period_from: '2026-10-08',
    period_to: '2026-11-07',
    week_key: '2026-W45',
    content: {
      headline: 'Compras se traba en aprobación',
      summary: 'Resumen general',
      flows: [{ key: 'pqr', definition_id: 7, name: 'PQR', text: 'La revisión del gerente tarda.' }],
      recommendations: ['Asignar un suplente'],
    },
    tokens_used: 900,
    model: null,
    error: null,
    created_at: '2026-11-07T13:00:00Z',
    ...overrides,
  };
}

describe('InsightsPageComponent', () => {
  let fixture: ComponentFixture<InsightsPageComponent>;
  let usageCalls: (string | undefined)[];
  let usageResult: () => Observable<WorkflowAiUsage>;
  let listResult: () => Observable<WorkflowSummariesList>;
  let generateResult: () => Observable<WorkflowSummary>;
  let generateCalls: number;
  let canManage: boolean;

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const q = (selector: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);
  const generateButton = (): HTMLButtonElement | null =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.includes('Generar ahora'),
    ) ?? null;

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(InsightsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    usageCalls = [];
    generateCalls = 0;
    canManage = true;
    usageResult = () => of(usage(quota({})));
    listResult = () => of({ items: [], can_generate: true, next_generate_at: null });
    generateResult = () => of(summary({}));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: WorkflowInsightsApiService,
          useValue: {
            getAiUsage: (month?: string) => {
              usageCalls.push(month);
              return usageResult();
            },
            listSummaries: () => listResult(),
            generateSummary: () => {
              generateCalls++;
              return generateResult();
            },
          },
        },
        {
          provide: AuthFacade,
          useValue: { isOwner: () => false, hasPermission: () => canManage },
        },
      ],
    });
  });

  it('muestra la barra del plan con el formato es-CO y los tokens de Flujos', async () => {
    await render();
    expect(q('[data-testid="quota-text"]')?.textContent).toContain('Usados 40.000 de 100.000 tokens este mes (40 %)');
    expect(q('[data-testid="flows-tokens"]')?.textContent).toContain('Tokens de Flujos: 5.400');
    expect(q('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');
    expect(usageCalls).toEqual([undefined]);
  });

  it('lista el consumo por flujo y por uso', async () => {
    await render();
    const byFlow = q('[data-testid="by-flow-table"]')?.textContent ?? '';
    expect(byFlow).toContain('PQR');
    expect(byFlow).toContain('4.000');
    const byPurpose = q('[data-testid="by-purpose-table"]')?.textContent ?? '';
    for (const label of [
      'Pasos de IA',
      'Pruebas de pasos de IA',
      'Lectura de documentos',
      'Resúmenes semanales',
    ]) {
      expect(byPurpose).toContain(label);
    }
  });

  it('al 80 % muestra la franja de aviso', async () => {
    usageResult = () => of(usage(quota({ state: 'warning', used: 80000, percent: 80 })));
    await render();
    expect(text()).toContain('Tus flujos llevan el 80 % del cupo de IA del plan');
    // The fill uses a theme color class (bg-warning-500 does not exist).
    expect(q('[role="progressbar"] > div')?.classList.contains('bg-warning')).toBeTrue();
  });

  it('al 100 % muestra la franja de cupo agotado', async () => {
    usageResult = () => of(usage(quota({ state: 'blocked', used: 100000, percent: 100 })));
    await render();
    expect(text()).toContain(
      'Cupo de IA agotado: los pasos de IA pasan a revisión manual hasta el próximo mes',
    );
    expect(q('[role="progressbar"] > div')?.classList.contains('bg-error')).toBeTrue();
  });

  it('sin IA en el plan lo dice', async () => {
    usageResult = () => of(usage(quota({ state: 'unavailable', cap: null, percent: null, used: 0 })));
    await render();
    expect(text()).toContain('Tu plan no incluye IA para Flujos');
    expect(q('[role="progressbar"]')).toBeNull();
  });

  it('sin tope mensual lo dice y no dibuja barra', async () => {
    usageResult = () => of(usage(quota({ cap: null, percent: null })));
    await render();
    expect(text()).toContain('Tu plan no tiene tope mensual de tokens');
    expect(q('[role="progressbar"]')).toBeNull();
  });

  it('un mes pasado pide ese mes y oculta la barra', async () => {
    await render();
    usageResult = () => of(usage(null, { month: '2026-10' }));
    const past = lastMonths(12)[1].value;
    fixture.componentInstance.onMonth(past);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(usageCalls).toEqual([undefined, past]);
    expect(q('[data-testid="quota-text"]')).toBeNull();
    expect(q('[role="progressbar"]')).toBeNull();
    expect(text()).toContain('Tokens de Flujos');
  });

  it('muestra el error de carga del consumo', async () => {
    usageResult = () => throwError(() => new HttpErrorResponse({ status: 500 }));
    await render();
    expect(q('[role="alert"]')).not.toBeNull();
    expect(q('[data-testid="quota-text"]')).toBeNull();
  });

  it('sin resúmenes muestra el estado vacío', async () => {
    await render();
    expect(q('[data-testid="no-summaries"]')?.textContent).toContain(
      'El primer resumen llega el lunes a las 8 a. m.',
    );
  });

  it('muestra el último resumen con su periodo, un párrafo por flujo y recomendaciones', async () => {
    listResult = () => of({ items: [summary({})], can_generate: true, next_generate_at: null });
    await render();
    const content = text();
    expect(content).toContain('Compras se traba en aprobación');
    expect(content).toContain('del 8 de octubre al 7 de noviembre');
    expect(content).toContain('La revisión del gerente tarda.');
    expect(content).toContain('Asignar un suplente');
  });

  it('el historial está colapsado y se abre con su botón', async () => {
    listResult = () =>
      of({
        items: [summary({}), summary({ id: 1, period_from: '2026-10-01', period_to: '2026-10-31' })],
        can_generate: true,
        next_generate_at: null,
      });
    await render();
    expect(q('[data-testid="history-item"]')).toBeNull();
    const toggle = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.includes('semanas anteriores'),
    );
    toggle?.click();
    fixture.detectChanges();
    expect(q('[data-testid="history-item"]')?.textContent).toContain('del 1 de octubre al 31 de octubre');
  });

  it('un resumen fallido o sin cupo se muestra como texto, no como excepción', async () => {
    listResult = () =>
      of({
        items: [
          summary({ id: 3, status: 'skipped_quota', content: null }),
          summary({ id: 2, status: 'failed', content: null, error: 'El proveedor no respondió' }),
        ],
        can_generate: false,
        next_generate_at: null,
      });
    await render();
    expect(q('[data-testid="summary-skipped"]')?.textContent).toContain('No se generó: cupo de IA agotado');
    fixture.componentInstance.historyOpen.set(true);
    fixture.detectChanges();
    expect(q('[data-testid="summary-failed"]')?.textContent).toContain('El proveedor no respondió');
  });

  it('con can_generate el botón genera y recarga la lista', async () => {
    await render();
    generateButton()?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(generateCalls).toBe(1);
  });

  it('sin can_generate el botón está deshabilitado y dice la hora', async () => {
    listResult = () =>
      of({ items: [summary({})], can_generate: false, next_generate_at: '2026-11-07T15:30:00' });
    await render();
    expect(generateButton()?.disabled).toBeTrue();
    expect(q('[data-testid="generate-hint"]')?.textContent).toMatch(/Podrás generar otro a las 15[:.]30/);
    generateButton()?.click();
    expect(generateCalls).toBe(0);
  });

  it('en 429 muestra el aviso de la hora', async () => {
    generateResult = () => throwError(() => new HttpErrorResponse({ status: 429 }));
    await render();
    generateButton()?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Ya se generó un resumen hace menos de una hora');
  });

  it('si la IA no tuvo cupo avisa sin error', async () => {
    generateResult = () => of(summary({ status: 'skipped_quota', content: null }));
    await render();
    generateButton()?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('No se generó: cupo de IA agotado');
  });

  it('quien no puede gestionar no ve el botón', async () => {
    canManage = false;
    await render();
    expect(generateButton()).toBeNull();
  });
});
