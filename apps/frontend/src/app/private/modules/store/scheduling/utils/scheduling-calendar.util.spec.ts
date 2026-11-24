import {
  filterValuesToQuery,
  hourRangeFor,
  layoutDay,
  monthGrid,
  rangeForView,
  shiftAnchor,
} from './scheduling-calendar.util';
import { buildSchedulingFilters, schedulingConfigActions } from './scheduling-ui.util';
import { schedulingParams } from '../services/scheduling-api.service';
import type { SchedulingEvent, SchedulingSources } from '../interfaces/scheduling.interface';

function ev(id: string, start: string, end: string, extra: Partial<SchedulingEvent> = {}): SchedulingEvent {
  return {
    id,
    type: 'booking',
    type_label: 'Reserva de servicio',
    source_id: 1,
    reference: 'R1',
    title: 'Corte',
    start: '',
    end: '',
    date: '2026-11-23',
    local_start: start,
    end_date: '2026-11-23',
    local_end: end,
    status: 'confirmed',
    status_label: 'Confirmada',
    status_group: 'confirmed',
    staff: null,
    customer: null,
    order_id: null,
    detail: null,
    ...extra,
  };
}

describe('Agenda unificada F1 — cálculo del calendario', () => {
  it('el mes se arma en semanas de lunes a domingo que cubren todo el mes', () => {
    const weeks = monthGrid('2026-11-23');
    expect(weeks[0][0]).toBe('2026-10-26');
    expect(weeks[weeks.length - 1][6]).toBe('2026-12-06');
    expect(weeks.every((w) => w.length === 7)).toBeTrue();
  });

  it('cada vista pide su rango y se mueve una unidad', () => {
    expect(rangeForView('day', '2026-11-23')).toEqual({ from: '2026-11-23', to: '2026-11-23' });
    expect(rangeForView('week', '2026-11-25')).toEqual({ from: '2026-11-23', to: '2026-11-29' });
    expect(rangeForView('month', '2026-11-10')).toEqual({ from: '2026-10-26', to: '2026-12-06' });
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftAnchor('week', '2026-11-23', -1)).toBe('2026-11-16');
    expect(shiftAnchor('day', '2026-12-31', 1)).toBe('2027-01-01');
  });

  it('la franja horaria se amplía para que quepa todo', () => {
    expect(hourRangeFor([])).toEqual({ start: 420, end: 1260 });
    expect(hourRangeFor([ev('a', '05:30', '06:00'), ev('b', '21:00', '22:15')])).toEqual({
      start: 300,
      end: 1380,
    });
    // Cruza la medianoche: llega al final del día.
    expect(hourRangeFor([ev('c', '22:00', '01:00', { end_date: '2026-11-24' })]).end).toBe(1440);
  });

  it('los eventos que se solapan comparten el ancho en carriles', () => {
    const placed = layoutDay(
      [ev('a', '09:00', '10:00'), ev('b', '09:30', '10:30'), ev('c', '11:00', '12:00')],
      { start: 480, end: 1080 },
    );
    const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]));
    expect(byId['a'].lanes).toBe(2);
    expect(byId['b'].lane).toBe(1);
    expect(byId['c'].lanes).toBe(1);
    expect(byId['a'].top).toBeCloseTo(10, 5);
    expect(byId['a'].height).toBeCloseTo(10, 5);
  });

  it('los filtros del dropdown se traducen a la query del backend', () => {
    expect(
      filterValuesToQuery({
        types: ['booking'],
        status_groups: ['pending', 'confirmed'],
        staff_ids: ['3', 'x'],
        date_start: '2026-11-01',
        date_end: null,
        show: 'all',
      }),
    ).toEqual({
      types: ['booking'],
      status_groups: ['pending', 'confirmed'],
      staff_ids: [3],
      from: '2026-11-01',
    });
    expect(filterValuesToQuery({})).toEqual({});
    expect(
      schedulingParams({ types: ['booking', 'scheduled_order'], search: '', page: 2 }).toString(),
    ).toBe('types=booking,scheduled_order&page=2');
  });

  it('solo muestra los filtros que aportan y los accesos de los módulos activos', () => {
    const sources: SchedulingSources = {
      timezone: 'America/Bogota',
      today: '2026-11-23',
      types: [{ value: 'scheduled_order', label: 'Pedido programado' }],
      status_groups: [{ value: 'pending', label: 'Pendiente' }],
      staff: [],
    };
    const keys = buildSchedulingFilters(sources, { withDateRange: true, withShow: false }).map(
      (f) => f.key,
    );
    expect(keys).toEqual(['status_groups', 'date']);
    const both = buildSchedulingFilters(
      {
        ...sources,
        types: [...sources.types, { value: 'booking', label: 'Reserva de servicio' }],
        staff: [{ id: 3, name: 'Ana' }],
      },
      { withDateRange: false, withShow: true },
    ).map((f) => f.key);
    expect(both).toEqual(['show', 'types', 'status_groups', 'staff_ids']);

    const onlyOrders = schedulingConfigActions({ bookings: false, scheduled: true, service: false });
    expect(onlyOrders.map((a) => a.action)).toEqual([
      '/admin/scheduled-orders/day',
      '/admin/scheduled-orders/production',
    ]);
    const service = schedulingConfigActions({ bookings: true, scheduled: false, service: true });
    expect(service.map((a) => a.action)).toContain('/admin/reservations/schedules');
    expect(service.map((a) => a.action)).toContain('/admin/reservations/queue');
    expect(service.map((a) => a.action)).toContain('/admin/services/stations');
  });
});
