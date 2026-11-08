import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/index';
import {
  WorkflowOpsAlertsPage,
  WorkflowOpsMetrics,
} from '../../interfaces/workflows-ops.interface';
import { WorkflowsOpsApiService } from '../../services/workflows-ops-api.service';
import { WorkflowsOpsPageComponent } from './workflows-ops-page.component';

const metrics = (over: Partial<WorkflowOpsMetrics> = {}): WorkflowOpsMetrics => ({
  generated_at: '2026-11-08T12:00:00.000Z',
  outbox: {
    by_status: { pending: 6, processing: 2, dead: 3 },
    by_kind: [],
    pending: 6,
    processing: 2,
    backlog_due: 4,
    oldest_due_age_seconds: 725,
    stuck_processing: 1,
    dead_1h: 2,
    dead_24h: 3,
    latency_1h: { p50_seconds: 1.5, p95_seconds: 9, samples: 40 },
  },
  webhooks: {
    by_status_24h: { delivered: 8, dead: 2 },
    success_rate_24h: 0.8,
    latency_24h: { p50_seconds: 0.4, p95_seconds: 2, samples: 8 },
    dead_total: 12,
  },
  inbound: { accepted_24h: 30, rejected_24h: 2 },
  top_stores: {
    by_backlog: [{ store_id: 7, store_name: 'Tienda Siete', count: 4 }],
    by_dead_24h: [],
  },
  recent_dead: [],
  dispatcher: { at: '2026-11-08T11:59:00.000Z', processed: 7, batches: 2, duration_ms: 900, age_seconds: 60 },
  ...over,
});

const alertsPage: WorkflowOpsAlertsPage = {
  alerts: [
    {
      id: 1,
      rule: 'dead_letters',
      severity: 'warning',
      title: 'Hay tareas de Flujos que fallaron definitivamente',
      details: { dead_1h: 7 },
      recipients: 2,
      created_at: '2026-11-08T11:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 10,
  totalPages: 1,
};

describe('WorkflowsOpsPageComponent', () => {
  let fixture: ComponentFixture<WorkflowsOpsPageComponent>;
  let api: jasmine.SpyObj<WorkflowsOpsApiService>;
  let toast: jasmine.SpyObj<ToastService>;

  const create = async () => {
    fixture = TestBed.createComponent(WorkflowsOpsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('WorkflowsOpsApiService', ['getMetrics', 'getAlerts']);
    api.getMetrics.and.returnValue(of(metrics()));
    api.getAlerts.and.returnValue(of(alertsPage));
    toast = jasmine.createSpyObj('ToastService', ['error', 'success']);
    TestBed.configureTestingModule({
      imports: [WorkflowsOpsPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: WorkflowsOpsApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  it('loads on open and shows every card with the platform figures', async () => {
    const cmp = await create();
    expect(api.getMetrics).toHaveBeenCalledTimes(1);
    const byTitle = Object.fromEntries(cmp.cards().map((c) => [c.title, c]));
    expect(byTitle['Pendientes'].value).toBe(6);
    expect(byTitle['Pendientes'].small).toBe('4 vencidas ahora');
    expect(byTitle['En proceso'].small).toBe('1 atascadas');
    expect(byTitle['Atraso del más viejo'].value).toBe('12 min');
    expect(String(byTitle['Latencia p50 / p95'].value)).toContain(' / ');
    expect(byTitle['Fallidos 1 h / 24 h'].value).toBe('2 / 3');
    expect(byTitle['Éxito de webhooks'].value).toBe('80 %');
    expect(byTitle['Entradas aceptadas / rechazadas'].value).toBe('30 / 2');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Tienda Siete');
    expect(text).toContain('Hay tareas de Flujos que fallaron definitivamente');
  });

  it('shows "Sin atraso" when no due row is waiting', async () => {
    const base = metrics();
    api.getMetrics.and.returnValue(
      of(metrics({ outbox: { ...base.outbox, oldest_due_age_seconds: null } })),
    );
    const cmp = await create();
    expect(cmp.cards().find((c) => c.title === 'Atraso del más viejo')?.value).toBe('Sin atraso');
  });

  it('the refresh button reloads metrics and alerts', async () => {
    const cmp = await create();
    cmp.refresh();
    expect(api.getMetrics).toHaveBeenCalledTimes(2);
    expect(api.getAlerts).toHaveBeenCalledTimes(2);
  });

  it('flags a dispatcher that has not reported for more than 5 minutes', async () => {
    const base = metrics();
    api.getMetrics.and.returnValue(
      of(metrics({ dispatcher: { ...base.dispatcher!, age_seconds: 900 } })),
    );
    const cmp = await create();
    expect(cmp.cycleStalled()).toBeTrue();
    expect(cmp.cycleText()).toContain('15 min');
  });

  it('says so when the dispatcher never reported', async () => {
    api.getMetrics.and.returnValue(of(metrics({ dispatcher: null })));
    const cmp = await create();
    expect(cmp.cycleText()).toContain('Sin registro de ciclos');
  });

  it('reports a failed load with a toast and a retry hint instead of empty zeros', async () => {
    api.getMetrics.and.returnValue(throwError(() => new Error('boom')));
    const cmp = await create();
    expect(cmp.loadFailed()).toBeTrue();
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.loading()).toBeFalse();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No se pudieron cargar');
  });
});
