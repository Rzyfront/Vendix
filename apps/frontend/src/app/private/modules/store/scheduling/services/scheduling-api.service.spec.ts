import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MenuFilterService } from '../../../../../core/services/menu-filter.service';
import { SchedulingApiService } from './scheduling-api.service';

describe('Agenda unificada F1 — cada parte solo con su key del panel', () => {
  let open: string[];
  let api: SchedulingApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    open = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MenuFilterService,
          useValue: { openAnyOfKeys: (keys: string[]) => keys.filter((k) => open.includes(k)) },
        },
      ],
    });
    api = TestBed.inject(SchedulingApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const SOURCES = {
    timezone: 'America/Bogota',
    today: '2026-11-25',
    types: [
      { value: 'booking', label: 'Reserva de servicio' },
      { value: 'scheduled_order', label: 'Pedido programado' },
    ],
    status_groups: [],
    staff: [{ id: 3, name: 'Ana' }],
  };

  it('con solo pedidos abiertos, las fuentes y el personal de reservas desaparecen', () => {
    open = ['orders_scheduled'];
    let result: any;
    api.getSources().subscribe((s) => (result = s));
    http.expectOne((r) => r.url.endsWith('/store/scheduling/sources')).flush({ success: true, data: SOURCES });
    expect(result.types.map((t: any) => t.value)).toEqual(['scheduled_order']);
    expect(result.staff).toEqual([]);
  });

  it('las consultas piden solo los tipos abiertos aunque la pantalla no filtre', () => {
    open = ['orders_reservations'];
    api.getEvents({ page: 1 }).subscribe();
    const events = http.expectOne((r) => r.url.endsWith('/store/scheduling/events'));
    expect(events.request.params.get('types')).toBe('booking');
    events.flush({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });

    api.getCalendar({ from: '2026-11-23', to: '2026-11-29', types: ['booking', 'scheduled_order'] }).subscribe();
    const calendar = http.expectOne((r) => r.url.endsWith('/store/scheduling/calendar'));
    expect(calendar.request.params.get('types')).toBe('booking');
    calendar.flush({ success: true, data: { data: [], truncated: false, types: [] } });
  });

  it('con las dos abiertas no recorta nada', () => {
    open = ['orders_reservations', 'orders_scheduled'];
    let result: any;
    api.getSources().subscribe((s) => (result = s));
    http.expectOne((r) => r.url.endsWith('/store/scheduling/sources')).flush({ success: true, data: SOURCES });
    expect(result.types.length).toBe(2);
    expect(result.staff.length).toBe(1);
  });
});
