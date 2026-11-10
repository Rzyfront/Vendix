import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  FulfillmentDay,
  FulfillmentSlot,
  PosScheduledOrderService,
} from './pos-scheduled-order.service';

const slot = (start: string, over: Partial<FulfillmentSlot> = {}): FulfillmentSlot => ({
  start: `2026-11-12T${start}:00.000Z`,
  end: `2026-11-12T${start}:59.000Z`,
  local_start: start,
  local_end: start,
  capacity: 4,
  taken: 0,
  available: true,
  blocked_reason: null,
  ...over,
});

const DAYS: FulfillmentDay[] = [
  { date: '2026-11-11', day_of_week: 3, blocked_reason: 'day_blocked', slots: [] },
  {
    date: '2026-11-12',
    day_of_week: 4,
    blocked_reason: null,
    slots: [slot('09:00'), slot('10:00', { available: false, blocked_reason: 'slot_full', taken: 4 })],
  },
];

describe('PosScheduledOrderService (pedido programado del POS)', () => {
  let service: PosScheduledOrderService;
  let httpGet: jasmine.Spy;

  beforeEach(() => {
    httpGet = jasmine.createSpy('get').and.returnValue(of({ data: DAYS }));
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: httpGet } },
        {
          provide: Store,
          useValue: { select: () => of({ scheduled_orders: { enabled: true, max_days_ahead: 7 } }) },
        },
      ],
    });
    service = TestBed.inject(PosScheduledOrderService);
  });

  it('activar carga la disponibilidad y deja el selector listo', () => {
    service.activate();
    expect(service.active()).toBeTrue();
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(service.days().length).toBe(2);
    expect(service.loading()).toBeFalse();
  });

  it('el payload del agendamiento lleva solo inicio y fin: el tipo lo deriva el backend del método de envío', () => {
    service.activate();
    service.selectDay('2026-11-12');
    service.selectSlot(DAYS[1].slots[0]);
    expect(service.hasSlot()).toBeTrue();
    expect(service.schedule()).toEqual({
      start: DAYS[1].slots[0].start,
      end: DAYS[1].slots[0].end,
    });
  });

  it('un día no disponible no se puede elegir y una franja llena tampoco', () => {
    service.activate();
    service.selectDay('2026-11-11');
    expect(service.selectedDate()).toBeNull();
    service.selectDay('2026-11-12');
    service.selectSlot(DAYS[1].slots[1]);
    expect(service.selectedStart()).toBeNull();
    expect(service.schedule()).toBeNull();
  });

  it('volver a tocar el mismo día conserva la franja elegida', () => {
    service.activate();
    service.selectDay('2026-11-12');
    service.selectSlot(DAYS[1].slots[0]);
    service.selectDay('2026-11-12');
    expect(service.hasSlot()).toBeTrue();
  });

  it('S4: el estado programado no se pierde por nada salvo reset (cobro, vaciar carrito o Quitar programación)', () => {
    service.activate();
    service.selectDay('2026-11-12');
    service.selectSlot(DAYS[1].slots[0]);
    const before = service.schedule();

    // Pasa el tiempo / se cierra y se reabre el modal: nadie toca el servicio.
    expect(service.active()).toBeTrue();
    expect(service.selectedDate()).toBe('2026-11-12');
    expect(service.schedule()).toEqual(before);

    service.reset();
    expect(service.active()).toBeFalse();
    expect(service.selectedDate()).toBeNull();
    expect(service.selectedStart()).toBeNull();
    expect(service.days()).toEqual([]);
    expect(service.schedule()).toBeNull();
  });
});
