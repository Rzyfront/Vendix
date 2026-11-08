import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import {
  WorkflowLimitsApiService,
  WorkflowUsageMetric,
  WorkflowUsageSnapshot,
} from '../../services/workflow-limits-api.service';
import { PlanUsagePageComponent } from './plan-usage-page.component';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function metric(over: Partial<WorkflowUsageMetric> & Pick<WorkflowUsageMetric, 'key'>): WorkflowUsageMetric {
  return { used: 0, cap: 100, percent: 0, state: 'ok', ...over };
}

function snapshot(metrics: WorkflowUsageMetric[]): WorkflowUsageSnapshot {
  return { period: '2026-11', metrics };
}

describe('PlanUsagePageComponent (P7.1)', () => {
  let fixture: ComponentFixture<PlanUsagePageComponent>;
  let usage: jasmine.Spy;

  async function render(result: Observable<WorkflowUsageSnapshot>) {
    usage = jasmine.createSpy('usage').and.returnValue(result);
    TestBed.configureTestingModule({
      imports: [PlanUsagePageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: WorkflowLimitsApiService, useValue: { usage } },
      ],
    });
    fixture = TestBed.createComponent(PlanUsagePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const meter = (key: string) => el().querySelector(`[data-testid="meter-${key}"]`) as HTMLElement;
  const text = (key: string) => meter(key).querySelector('[data-testid="meter-text"]')!.textContent!.trim();

  const all = (over: Record<string, Partial<WorkflowUsageMetric>> = {}) =>
    snapshot([
      metric({ key: 'monthly_instances', used: 3, cap: 10, percent: 30, ...over['monthly_instances'] }),
      metric({ key: 'monthly_http_calls', used: 5, cap: 50, percent: 10, ...over['monthly_http_calls'] }),
      metric({ key: 'storage_bytes', used: 300 * MB, cap: 10 * GB, percent: 2, ...over['storage_bytes'] }),
      metric({ key: 'monthly_ai_tokens', used: 1200, cap: 100000, percent: 1, ...over['monthly_ai_tokens'] }),
    ]);

  it('shows the four meters with used of cap', async () => {
    await render(of(all()));
    expect(text('monthly_instances')).toBe('Solicitudes este mes: 3 de 10');
    expect(text('monthly_http_calls')).toBe('Llamadas HTTP este mes: 5 de 50');
    expect(text('storage_bytes')).toBe('Almacenamiento: 300 MB de 10 GB');
    expect(text('monthly_ai_tokens')).toContain('Tokens de IA');
  });

  it('paints the bar blue under 80 %, yellow from 80 % and red at 100 %', async () => {
    await render(
      of(
        all({
          monthly_instances: { used: 3, percent: 30, state: 'ok' },
          monthly_http_calls: { used: 40, percent: 80, state: 'warning' },
          storage_bytes: { used: 10 * GB, percent: 100, state: 'blocked' },
        }),
      ),
    );
    const bar = (key: string) => meter(key).querySelector('[data-testid="meter-bar"]') as HTMLElement;
    expect(bar('monthly_instances').classList).toContain('bg-primary');
    expect(bar('monthly_http_calls').classList).toContain('bg-warning');
    expect(bar('storage_bytes').classList).toContain('bg-error');
    expect(bar('monthly_http_calls').style.width).toBe('80%');
  });

  it('reads "Sin límite" when unlimited and no bar', async () => {
    await render(
      of(all({ monthly_instances: { cap: null, percent: null, state: 'unlimited', used: 7 } })),
    );
    expect(text('monthly_instances')).toContain('Sin límite');
    expect(meter('monthly_instances').querySelector('[data-testid="meter-bar"]')).toBeNull();
  });

  it('reads "No incluido en tu plan" when the plan does not include it', async () => {
    await render(
      of(all({ monthly_ai_tokens: { cap: null, percent: null, state: 'unavailable', used: 0 } })),
    );
    expect(text('monthly_ai_tokens')).toBe('No incluido en tu plan');
  });

  it('links "Mejorar plan" to the store plans and warns when a limit is blocked', async () => {
    await render(of(all({ monthly_instances: { used: 10, percent: 100, state: 'blocked' } })));
    const link = el().querySelector('[data-testid="upgrade-link"]') as HTMLAnchorElement;
    expect(link.textContent!.trim()).toBe('Mejorar plan');
    expect(link.getAttribute('href')).toBe('/admin/subscription/plans');
    expect(el().querySelector('[data-testid="blocked-banner"]')).not.toBeNull();
  });

  it('no banner when nothing is blocked', async () => {
    await render(of(all()));
    expect(el().querySelector('[data-testid="blocked-banner"]')).toBeNull();
  });

  it('shows an error message when the usage cannot be loaded', async () => {
    await render(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'x' } })));
    expect(el().querySelector('app-alert-banner')).not.toBeNull();
    expect(el().querySelector('[data-testid="meter-monthly_instances"]')).toBeNull();
  });
});
