import { Component, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { SchedulingApiService } from '../services/scheduling-api.service';
import { SchedulingRecordHostComponent } from '../components/scheduling-record-host/scheduling-record-host.component';
import { SchedulingListPageComponent } from './scheduling-list-page/scheduling-list-page.component';
import { SchedulingAgendaPageComponent } from './scheduling-agenda-page/scheduling-agenda-page.component';
import type { SchedulingEvent, SchedulingSources } from '../interfaces/scheduling.interface';
import { agendaUrl } from '../scheduling-tabs';
import { ModuleShellActionsService } from '../../../../../shared/components/module-tabs-shell/module-shell-actions.service';
import { ProductionSseService } from '../../restaurant-ops/production/services/production-sse.service';
import { RescheduleRequestsCounterService } from '../services/reschedule-requests-counter.service';
import { EventCalendarComponent } from '../components/event-calendar/event-calendar.component';
import { storeClock } from '../utils/scheduling-calendar.util';
import { addDays } from '../../scheduled-orders/utils/ymd.util';

/** Sustituye los modales de las fuentes: aquí solo importa la pantalla. */
@Component({ selector: 'app-scheduling-record-host', standalone: true, template: '' })
class RecordHostStub {
  readonly changed = output<void>();
  open = jasmine.createSpy('open');
  createBooking = jasmine.createSpy('createBooking');
  createBookingAt = jasmine.createSpy('createBookingAt');
  rescheduleScheduledOrder = jasmine.createSpy('rescheduleScheduledOrder');
}

/** Configuración de Reservas que debe seguir alcanzable (requisito de prestadores). */
const CONFIG_ROUTES = [
  agendaUrl('configuracion', 'equipo'),
  agendaUrl('configuracion', 'disponibilidad'),
  agendaUrl('cola'),
  agendaUrl('configuracion', 'horario'),
  '/admin/reservations/reschedule-requests',
  '/admin/reservations/payment-requests',
  '/admin/reservations/reminders',
  '/admin/services/stations',
];

const SOURCES: SchedulingSources = {
  timezone: 'America/Bogota',
  today: '2026-11-25',
  types: [
    { value: 'booking', label: 'Reserva de servicio' },
    { value: 'scheduled_order', label: 'Pedido programado' },
  ],
  status_groups: [{ value: 'pending', label: 'Pendiente' }],
  staff: [{ id: 3, name: 'Ana' }],
};

const EVENT: SchedulingEvent = {
  id: 'booking:1',
  type: 'booking',
  type_label: 'Reserva de servicio',
  source_id: 1,
  reference: 'RES-1',
  title: 'Corte de cabello',
  start: '2026-11-25T14:00:00.000Z',
  end: '2026-11-25T15:00:00.000Z',
  date: '2026-11-25',
  local_start: '09:00',
  end_date: '2026-11-25',
  local_end: '10:00',
  status: 'confirmed',
  status_label: 'Confirmada',
  status_group: 'confirmed',
  staff: { id: 3, name: 'Ana' },
  customer: { id: 9, name: 'María' },
  order_id: null,
  detail: 'Corte de cabello',
};

let sse: { canStream: jasmine.Spy; listen: jasmine.Spy };
let counter: { count: ReturnType<typeof signal<number>>; watch: jasmine.Spy };

function setup(sources: SchedulingSources = SOURCES) {
  sse = { canStream: jasmine.createSpy('canStream').and.returnValue(true), listen: jasmine.createSpy('listen') };
  counter = { count: signal(3), watch: jasmine.createSpy('watch') };
  const api = {
    getSources: jasmine.createSpy('getSources').and.returnValue(of(sources)),
    getEvents: jasmine
      .createSpy('getEvents')
      .and.returnValue(of({ data: [EVENT], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } })),
    getCalendar: jasmine.createSpy('getCalendar').and.callFake((q: { staff_ids?: number[] }) =>
      of({
        data: [EVENT],
        truncated: false,
        types: ['booking'],
        availability: q.staff_ids?.length
          ? [
              { staff_id: 3, date: '2026-11-23', windows: [{ start: '09:00', end: '13:00' }], unavailable: false, reason: null },
              { staff_id: 3, date: '2026-11-24', windows: [], unavailable: true, reason: 'Vacaciones' },
              { staff_id: 3, date: '2026-11-25', windows: [], unavailable: false, reason: null },
            ]
          : [],
      }),
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SchedulingApiService, useValue: api },
      {
        provide: AuthFacade,
        useValue: {
          isServiceIndustry: signal(true),
          hasPermission: () => true,
          // Sin permiso de producción: el SSE no se abre en las pruebas.
          hasAnyPermission: () => false,
        },
      },
      { provide: StoreSettingsFacade, useValue: { timezone: signal('America/Bogota') } },
      { provide: ProductionSseService, useValue: sse },
      { provide: RescheduleRequestsCounterService, useValue: counter },
    ],
  });
  for (const page of [SchedulingListPageComponent, SchedulingAgendaPageComponent]) {
    TestBed.overrideComponent(page as any, {
      remove: { imports: [SchedulingRecordHostComponent] },
      add: { imports: [RecordHostStub] },
    });
  }
  return api;
}

describe('Agenda unificada F1 — Programación', () => {
  it('carga desde hoy, en orden cronológico y paginada en servidor', () => {
    const api = setup();
    const fixture = TestBed.createComponent(SchedulingListPageComponent);
    fixture.detectChanges();
    expect(api.getEvents).toHaveBeenCalledWith(
      jasmine.objectContaining({ from: '2026-11-25', order: 'asc', page: 1, limit: 20 }),
    );
    expect(fixture.nativeElement.textContent).toContain('Programación (1)');
    expect(fixture.nativeElement.textContent).toContain('Corte de cabello');
  });

  it('«Todo» muestra lo más reciente primero y un rango manda sobre «Próximos»', () => {
    const api = setup();
    const page = TestBed.createComponent(SchedulingListPageComponent).componentInstance;
    page.onFilterChange({ show: 'all' });
    const all = api.getEvents.calls.mostRecent().args[0];
    expect(all.order).toBe('desc');
    expect(all.from).toBeUndefined();

    page.onFilterChange({ date_start: '2026-11-01', date_end: '2026-11-30', types: ['booking'] });
    expect(api.getEvents.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ from: '2026-11-01', to: '2026-11-30', types: ['booking'], order: 'asc', page: 1 }),
    );
  });

  it('ofrece la configuración de reservas y de pedidos en Opciones', () => {
    setup();
    const page = TestBed.createComponent(SchedulingListPageComponent).componentInstance;
    const actions = page.dropdownActions().map((a) => a.action);
    expect(actions).toContain(agendaUrl('configuracion', 'equipo'));
    expect(actions).toContain(agendaUrl('configuracion', 'disponibilidad'));
    expect(actions).toContain('/admin/scheduled-orders/day');
  });

  it('muestra acceso directo a Equipo de servicio y Disponibilidad, y toda la configuración en Opciones', () => {
    setup();
    const page = TestBed.createComponent(SchedulingListPageComponent).componentInstance;
    const visible = page.headerActions().filter((a) => a.visible !== false).map((a) => a.id);
    expect(visible).toContain(agendaUrl('configuracion', 'equipo'));
    expect(visible).toContain(agendaUrl('configuracion', 'disponibilidad'));
    const actions = page.dropdownActions().map((a) => a.action);
    for (const route of CONFIG_ROUTES) expect(actions).withContext(route).toContain(route);
  });

  it('sin reservas habilitadas no ofrece la configuración de prestadores', () => {
    setup({ ...SOURCES, types: [{ value: 'scheduled_order', label: 'Pedido programado' }], staff: [] });
    const page = TestBed.createComponent(SchedulingListPageComponent).componentInstance;
    const visible = page.headerActions().filter((a) => a.visible !== false).map((a) => a.id);
    expect(visible).not.toContain(agendaUrl('configuracion', 'equipo'));
    expect(page.dropdownActions().map((a) => a.action)).not.toContain(agendaUrl('configuracion', 'equipo'));
  });

  it('sin fuentes habilitadas explica por qué y no pide eventos', () => {
    const api = setup({ ...SOURCES, types: [], staff: [] });
    const fixture = TestBed.createComponent(SchedulingListPageComponent);
    fixture.detectChanges();
    expect(api.getEvents).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('No hay nada que programar');
  });
});

describe('Agenda unificada F1 — Agenda', () => {
  it('abre en la semana de hoy (zona de la tienda) y pinta los eventos', () => {
    const api = setup();
    const fixture = TestBed.createComponent(SchedulingAgendaPageComponent);
    // Escritorio: semana. (En celular la semana se muestra como día.)
    fixture.componentInstance.isMobile.set(false);
    fixture.componentInstance.goToday();
    fixture.detectChanges();
    expect(api.getCalendar.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ from: '2026-11-23', to: '2026-11-29' }),
    );
    fixture.componentInstance.isMobile.set(true);
    fixture.componentInstance.goToday();
    expect(fixture.componentInstance.effectiveView()).toBe('day');
    expect(api.getCalendar.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ from: '2026-11-25', to: '2026-11-25' }),
    );
    expect(fixture.nativeElement.textContent).toContain('Corte de cabello');
  });

  it('cambia a mes y al tocar un día abre la vista Día', () => {
    const api = setup();
    const page = TestBed.createComponent(SchedulingAgendaPageComponent).componentInstance;
    page.isMobile.set(false);
    page.setView('month');
    expect(api.getCalendar.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ from: '2026-10-26', to: '2026-12-06' }),
    );
    page.openDay('2026-11-27');
    expect(page.effectiveView()).toBe('day');
    expect(api.getCalendar.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ from: '2026-11-27', to: '2026-11-27' }),
    );
  });

  it('encabezado de una sola fila: en celular la vista vive dentro de Filtros y no hay texto de ayuda', () => {
    const api = setup();
    const fixture = TestBed.createComponent(SchedulingAgendaPageComponent);
    const page = fixture.componentInstance;
    page.isMobile.set(false);
    fixture.detectChanges();
    let el: HTMLElement = fixture.nativeElement;
    const toolbar = el.querySelector('[data-testid="agenda-toolbar"]')!;
    expect(toolbar.querySelector('app-input-buttons')).not.toBeNull();
    expect(toolbar.querySelector('app-inputsearch')).not.toBeNull();
    expect(page.filterConfigs().some((f) => f.key === 'vista')).toBeFalse();
    expect(el.textContent).not.toContain('Filtra por personal');

    page.isMobile.set(true);
    fixture.detectChanges();
    el = fixture.nativeElement;
    expect(el.querySelector('[data-testid="agenda-toolbar"] app-input-buttons')).toBeNull();
    expect(el.querySelector('[data-testid="agenda-toolbar"] app-inputsearch')).toBeNull();
    expect(el.querySelector('[data-testid="agenda-search-toggle"]')).not.toBeNull();
    const view = page.filterConfigs()[0];
    expect(view.key).toBe('vista');
    expect(view.countsAsActive).toBeFalse();
    expect(view.options?.map((o) => o.label)).toEqual(['Mes', 'Día']);

    page.onFilterChange({ vista: 'month', staff_ids: ['3'] });
    expect(page.view()).toBe('month');
    expect(page.filterValues()).toEqual({ staff_ids: ['3'] });
    expect(api.getCalendar.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ from: '2026-10-26', to: '2026-12-06', staff_ids: [3] }),
    );

    page.mobileSearchOpen.set(true);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="agenda-toolbar"] app-inputsearch')).not.toBeNull();
  });

  it('los filtros viajan al calendario sin pisar el rango de la vista', () => {
    const api = setup();
    const page = TestBed.createComponent(SchedulingAgendaPageComponent).componentInstance;
    page.isMobile.set(false);
    page.onFilterChange({ staff_ids: ['3'], date_start: '2020-01-01' });
    const query = api.getCalendar.calls.mostRecent().args[0];
    expect(query.staff_ids).toEqual([3]);
    expect(query.from).toBe('2026-11-23');
  });

  it('ofrece la configuración de prestadores también desde la Agenda', () => {
    setup();
    const page = TestBed.createComponent(SchedulingAgendaPageComponent).componentInstance;
    const visible = page.headerActions().filter((a) => a.visible !== false).map((a) => a.id);
    expect(visible).toContain(agendaUrl('configuracion', 'equipo'));
    expect(visible).toContain(agendaUrl('configuracion', 'disponibilidad'));
    const actions = page.dropdownActions().map((a) => a.action);
    for (const route of CONFIG_ROUTES) expect(actions).withContext(route).toContain(route);
  });

  it('con un prestador filtrado sombrea fuera de su horario y marca sus excepciones', () => {
    setup();
    const fixture = TestBed.createComponent(SchedulingAgendaPageComponent);
    const page = fixture.componentInstance;
    page.isMobile.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="off-hours"]').length).toBe(0);

    page.onFilterChange({ staff_ids: ['3'] });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(page.availability().length).toBe(3);
    expect(el.querySelector('[data-testid="availability-hint"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="off-hours"]').length).toBeGreaterThan(0);
    const labels = Array.from(el.querySelectorAll('[data-testid="day-unavailable"]')).map((n) => n.textContent?.trim());
    expect(labels).toContain('No disponible: Vacaciones');
    // Los días sin bloques para el prestador quedan como «Sin horario».
    expect(labels).toContain('Sin horario');
  });
});

describe('Agenda unificada F1 — pestañas embebidas', () => {
  it('dentro de Agenda no pintan cabecera propia y publican sus botones en la del módulo', () => {
    setup();
    const shell = TestBed.inject(ModuleShellActionsService);
    const list = TestBed.createComponent(SchedulingListPageComponent);
    list.componentRef.setInput('embedded', true);
    list.detectChanges();
    TestBed.flushEffects();
    expect(list.nativeElement.querySelector('app-sticky-header')).toBeNull();
    const ids = shell.buttons().filter((b) => b.visible !== false).map((b) => b.id);
    expect(ids).toContain(agendaUrl('configuracion', 'equipo'));
    expect(ids).toContain('create-booking');
    // «Ver calendario» sobra: el calendario es otra pestaña.
    expect(ids).not.toContain('agenda');
    list.destroy();
    expect(shell.buttons()).toEqual([]);

    const cal = TestBed.createComponent(SchedulingAgendaPageComponent);
    cal.componentRef.setInput('embedded', true);
    cal.componentInstance.isMobile.set(false);
    cal.detectChanges();
    TestBed.flushEffects();
    expect(cal.nativeElement.querySelector('app-sticky-header')).toBeNull();
    expect(shell.buttons().filter((b) => b.visible !== false).map((b) => b.id)).not.toContain('list');
  });
});

describe('Agenda unificada F1 — lo que se portó de las pantallas viejas', () => {
  for (const [name, page] of [
    ['Programación', SchedulingListPageComponent],
    ['Calendario', SchedulingAgendaPageComponent],
  ] as const) {
    it(`${name}: pedidos en vivo por SSE (recarga en silencio) y botón «Reagendas (n)»`, () => {
      const api = setup();
      const fixture = TestBed.createComponent(page as any);
      const cmp = fixture.componentInstance as any;
      expect(sse.listen).toHaveBeenCalledTimes(1);
      expect(counter.watch).toHaveBeenCalledTimes(1);
      const calls = (page === SchedulingListPageComponent ? api.getEvents : api.getCalendar).calls.count();
      sse.listen.calls.mostRecent().args[1]();
      expect((page === SchedulingListPageComponent ? api.getEvents : api.getCalendar).calls.count()).toBe(calls + 1);
      expect(cmp.loading()).toBeFalse();
      const button = cmp.headerActions().find((a: any) => a.id === '/admin/reservations/reschedule-requests');
      expect(button?.label).toBe('Reagendas (3)');
      expect(button?.visible).toBeTrue();
    });
  }

  it('sin pedidos no abre el SSE; sin reservas no cuenta reagendas', () => {
    setup({ ...SOURCES, types: [{ value: 'booking', label: 'Reserva de servicio' }] });
    TestBed.createComponent(SchedulingListPageComponent);
    expect(sse.listen).not.toHaveBeenCalled();
    expect(counter.watch).toHaveBeenCalled();
    TestBed.resetTestingModule();
    setup({ ...SOURCES, types: [{ value: 'scheduled_order', label: 'Pedido programado' }], staff: [] });
    TestBed.createComponent(SchedulingAgendaPageComponent);
    expect(counter.watch).not.toHaveBeenCalled();
  });

  it('Calendario: tocar un hueco futuro abre la reserva rápida con día y hora; uno pasado no', () => {
    setup();
    const fixture = TestBed.createComponent(SchedulingAgendaPageComponent);
    fixture.componentInstance.isMobile.set(false);
    fixture.detectChanges();
    // `viewChild.required` busca la clase real; el stub se inyecta a mano.
    const host = { createBookingAt: jasmine.createSpy('createBookingAt') };
    (fixture.componentInstance as any).host = () => host;
    fixture.componentInstance.onSlotClick({ date: '2026-11-26', time: '10:30' });
    expect(host.createBookingAt).toHaveBeenCalledWith('2026-11-26', '10:30');
    fixture.componentInstance.onSlotClick({ date: '2026-11-24', time: '10:30' });
    expect(host.createBookingAt).toHaveBeenCalledTimes(1);
  });
});

describe('Agenda unificada F1 — hueco tocado en el calendario', () => {
  it('convierte la altura del clic en la hora del hueco (múltiplo de 30 min) y no cuenta clics en eventos', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(EventCalendarComponent);
    fixture.componentRef.setInput('view', 'day');
    fixture.componentRef.setInput('anchor', '2026-11-26');
    fixture.componentRef.setInput('slotClickable', true);
    const cmp = fixture.componentInstance;
    const emitted: Array<{ date: string; time: string }> = [];
    cmp.slotClick.subscribe((slot) => emitted.push(slot));
    const column = { getBoundingClientRect: () => ({ top: 0, height: 1440 }) };
    const plain = document.createElement('div');
    // Rejilla de 24 h (1440 min en 1440 px): 640 px → 10:40 → 10:30.
    cmp.onGridClick({ clientY: 640, target: plain, currentTarget: column } as unknown as MouseEvent, '2026-11-26');
    expect(emitted).toEqual([{ date: '2026-11-26', time: '10:30' }]);
    const button = document.createElement('button');
    cmp.onGridClick({ clientY: 640, target: button, currentTarget: column } as unknown as MouseEvent, '2026-11-26');
    expect(emitted.length).toBe(1);
    fixture.componentRef.setInput('slotClickable', false);
    cmp.onGridClick({ clientY: 640, target: plain, currentTarget: column } as unknown as MouseEvent, '2026-11-26');
    expect(emitted.length).toBe(1);
  });
});

describe('Agenda 24 h — rejilla completa, línea de ahora y reservas nocturnas', () => {
  const TZ = 'America/Bogota';
  const todayInStore = () => storeClock(new Date(), TZ).date;
  const nightEvent = (date: string, endDate: string): SchedulingEvent => ({
    id: 'booking:9',
    type: 'booking',
    type_label: 'Reserva de servicio',
    source_id: 9,
    reference: 'R9',
    title: 'Turno nocturno',
    start: '',
    end: '',
    date,
    local_start: '23:00',
    end_date: endDate,
    local_end: '01:00',
    status: 'confirmed',
    status_label: 'Confirmada',
    status_group: 'confirmed',
    staff: null,
    customer: null,
    order_id: null,
    detail: null,
  });

  function render(view: 'week' | 'day', anchor: string, events: SchedulingEvent[] = []) {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(EventCalendarComponent);
    fixture.componentRef.setInput('view', view);
    fixture.componentRef.setInput('anchor', anchor);
    fixture.componentRef.setInput('timezone', TZ);
    fixture.componentRef.setInput('events', events);
    fixture.detectChanges();
    return fixture;
  }

  it('muestra las 24 horas y la línea de ahora solo en la columna de hoy', () => {
    const fixture = render('week', todayInStore());
    const el: HTMLElement = fixture.nativeElement;
    expect(fixture.componentInstance.hours().length).toBe(24);
    expect(fixture.componentInstance.hours()[0]).toBe('00:00');
    const lines = el.querySelectorAll('[data-testid="now-line"]');
    expect(lines.length).toBe(1);
    expect(lines[0].closest('[data-day]')?.getAttribute('data-day')).toBe(todayInStore());
  });

  it('no pinta la línea de ahora en otra semana', () => {
    const fixture = render('week', addDays(todayInStore(), 14));
    expect(fixture.nativeElement.querySelectorAll('[data-testid="now-line"]').length).toBe(0);
  });

  it('enfoca la hora actual cuando hoy está visible', () => {
    const fixture = render('day', todayInStore());
    expect(fixture.componentInstance.focusMinutes()).toBe(storeClock(new Date(), TZ).minutes);
  });

  it('una reserva 23:00–01:00 aparece en sus dos días', () => {
    const fixture = render('week', '2026-11-23', [nightEvent('2026-11-24', '2026-11-25')]);
    const el: HTMLElement = fixture.nativeElement;
    const blocks = Array.from(el.querySelectorAll('[data-day] .ev-block'));
    expect(blocks.map((b) => b.closest('[data-day]')?.getAttribute('data-day'))).toEqual(['2026-11-24', '2026-11-25']);
    expect(blocks[1].getAttribute('data-continued')).toBe('true');
  });
});
