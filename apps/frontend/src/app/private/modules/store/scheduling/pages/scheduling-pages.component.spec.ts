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

/** Sustituye los modales de las fuentes: aquí solo importa la pantalla. */
@Component({ selector: 'app-scheduling-record-host', standalone: true, template: '' })
class RecordHostStub {
  readonly changed = output<void>();
  open = jasmine.createSpy('open');
  createBooking = jasmine.createSpy('createBooking');
  rescheduleScheduledOrder = jasmine.createSpy('rescheduleScheduledOrder');
}

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

function setup(sources: SchedulingSources = SOURCES) {
  const api = {
    getSources: jasmine.createSpy('getSources').and.returnValue(of(sources)),
    getEvents: jasmine
      .createSpy('getEvents')
      .and.returnValue(of({ data: [EVENT], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } })),
    getCalendar: jasmine
      .createSpy('getCalendar')
      .and.returnValue(of({ data: [EVENT], truncated: false, types: ['booking'] })),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SchedulingApiService, useValue: api },
      {
        provide: AuthFacade,
        useValue: { isServiceIndustry: signal(true), hasPermission: () => true },
      },
      { provide: StoreSettingsFacade, useValue: { timezone: signal('America/Bogota') } },
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
    expect(actions).toContain('/admin/reservations/schedules');
    expect(actions).toContain('/admin/reservations/availability');
    expect(actions).toContain('/admin/scheduled-orders/day');
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

  it('los filtros viajan al calendario sin pisar el rango de la vista', () => {
    const api = setup();
    const page = TestBed.createComponent(SchedulingAgendaPageComponent).componentInstance;
    page.isMobile.set(false);
    page.onFilterChange({ staff_ids: ['3'], date_start: '2020-01-01' });
    const query = api.getCalendar.calls.mostRecent().args[0];
    expect(query.staff_ids).toEqual([3]);
    expect(query.from).toBe('2026-11-23');
  });
});
