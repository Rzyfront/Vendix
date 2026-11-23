import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Subject, of } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/index';
import {
  PlatformAlertView,
  PlatformAlertsStats,
} from '../../interfaces';
import { MonitoringAlertsService, MonitoringService } from '../../services';
import { MonitoringAlertsPage } from './monitoring-alerts.page';

const alert = (over: Partial<PlatformAlertView> = {}): PlatformAlertView => ({
  id: 5,
  source: 'http',
  process: 'POST /api/store/payments',
  error_type: 'HTTP_500',
  severity: 'critical',
  status: 'open',
  title: 'Falla en pagos',
  message: 'Error saneado',
  details: { route: '/api/store/payments/:id', attempts: 3 },
  organization_id: null,
  store_id: 9,
  affected_store_ids: [9],
  occurrences: 4,
  first_seen_at: '2026-11-17T10:00:00.000Z',
  last_seen_at: '2026-11-17T11:00:00.000Z',
  escalated_at: null,
  resolved_at: null,
  resolution: null,
  ticket_number: 'INC-10',
  ticket_status: 'open',
  telegram_sent: true,
  context: [{ label: 'Tienda', value: 'Tienda 9 (id 9)' }],
  scope_label: 'Tienda 9 (id 9)',
  category: null,
  kind_label: 'Petición fallida',
  ...over,
});

const stats: PlatformAlertsStats = {
  open_critical: 2,
  open_warning: 3,
  open_info: 1,
  last_24h: 8,
  telegram_enabled: true,
  email_recipients: 2,
};

describe('MonitoringAlertsPage', () => {
  let fixture: ComponentFixture<MonitoringAlertsPage>;
  let api: jasmine.SpyObj<MonitoringAlertsService>;
  let toast: jasmine.SpyObj<ToastService>;
  const meta = { total: 1, page: 1, limit: 20, totalPages: 1 };

  const create = async () => {
    fixture = TestBed.createComponent(MonitoringAlertsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('MonitoringAlertsService', [
      'list',
      'getStats',
      'getById',
      'resolve',
      'sendTest',
    ]);
    api.list.and.returnValue(of({ data: [alert()], meta }));
    api.getStats.and.returnValue(of(stats));
    api.getById.and.returnValue(of(alert()));
    api.resolve.and.returnValue(of(alert({ status: 'resolved', resolution: 'manual' })));
    api.sendTest.and.returnValue(
      of({ alert_id: 1, occurrences: 2, ticket_number: 'INC-11', telegram_sent: true }),
    );
    toast = jasmine.createSpyObj('ToastService', ['error', 'success']);
    TestBed.configureTestingModule({
      imports: [MonitoringAlertsPage],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MonitoringAlertsService, useValue: api },
        {
          provide: MonitoringService,
          useValue: { manualRefresh$: new Subject<void>(), autoRefresh: signal(false) },
        },
        { provide: ToastService, useValue: toast },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });
  });

  it('loads the open alerts and the stats on open', async () => {
    const cmp = await create();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ status: 'open', page: 1, limit: 20 }),
    );
    expect(api.getStats).toHaveBeenCalledTimes(1);
    const byTitle = Object.fromEntries(cmp.cards().map((c) => [c.title, c]));
    expect(byTitle['Graves abiertas'].value).toBe(2);
    expect(byTitle['Leves abiertas'].value).toBe(4);
    expect(byTitle['Últimas 24 h'].value).toBe(8);
    expect(byTitle['Telegram'].value).toBe('Activo');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Falla en pagos');
  });

  it('changing the severity filter resets to page 1 and reloads with the filter', async () => {
    const cmp = await create();
    cmp.onPageChange(3);
    cmp.onSeverityChange('warning');
    const args = api.list.calls.mostRecent().args[0];
    expect(args.severity).toBe('warning');
    expect(args.page).toBe(1);
  });

  it('"Marcar resuelta" resolves the alert, toasts and refreshes list and stats', async () => {
    const cmp = await create();
    cmp.openDetail(alert());
    expect(api.getById).toHaveBeenCalledWith(5);
    cmp.resolveSelected();
    expect(api.resolve).toHaveBeenCalledWith(5);
    expect(toast.success).toHaveBeenCalled();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.getStats).toHaveBeenCalledTimes(2);
    expect(cmp.detailOpen()).toBeFalse();
  });

  it('does not resolve an alert that is already resolved', async () => {
    const cmp = await create();
    api.getById.and.returnValue(of(alert({ status: 'resolved' })));
    cmp.openDetail(alert({ status: 'resolved' }));
    cmp.resolveSelected();
    expect(api.resolve).not.toHaveBeenCalled();
  });

  it('renders details as key/value entries instead of raw JSON', async () => {
    const cmp = await create();
    cmp.openDetail(alert());
    expect(cmp.detailEntries()).toEqual([
      { key: 'route', value: '/api/store/payments/:id' },
      { key: 'attempts', value: '3' },
    ]);
  });

  it('the test modal sends the chosen severity and refreshes', async () => {
    const cmp = await create();
    cmp.openTestModal();
    expect(cmp.testOpen()).toBeTrue();
    cmp.onTestSeverityChange('critical');
    cmp.sendTest();
    expect(api.sendTest).toHaveBeenCalledWith('critical');
    expect(toast.success).toHaveBeenCalledWith(jasmine.stringContaining('INC-11'));
    expect(cmp.testOpen()).toBeFalse();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('?alert=<id> (enlace "Ver en Superadmin") abre el detalle con las líneas de contexto', async () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { queryParamMap: of(convertToParamMap({ alert: '5' })) },
    });
    api.getById.and.returnValue(
      of(
        alert({
          category: 'plan_limit',
          kind_label: 'Límite de plan',
          context: [
            { label: 'Tienda', value: 'Vendix Granizzo (testbalmes, id 105)' },
            { label: 'Módulo', value: 'Productos' },
          ],
        }),
      ),
    );
    const cmp = await create();
    fixture.detectChanges();
    expect(api.getById).toHaveBeenCalledWith(5);
    expect(cmp.detailOpen()).toBeTrue();
    expect(cmp.selected()?.category).toBe('plan_limit');
  });
});

