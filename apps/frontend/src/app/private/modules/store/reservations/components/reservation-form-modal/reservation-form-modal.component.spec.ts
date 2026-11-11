import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { ReservationFormModalComponent } from './reservation-form-modal.component';
import { ReservationsService } from '../../services/reservations.service';
import { ServiceStationsService } from '../service-stations/service-stations.service';
import { ToastService } from '../../../../../../shared/components';
import { PaymentMethodsService } from '../../../settings/payments/services/payment-methods.service';

describe('ReservationFormModalComponent — station + schedule rules', () => {
  const stations: any[] = [
    { id: 1, name: 'Cancha 1', status: 'active', services: [{ product_id: 9 }], providers: [] },
    { id: 2, name: 'Cancha 2', status: 'active', services: [{ product_id: 9 }], providers: [] },
  ];
  let availability: jasmine.Spy;

  const create = () => {
    availability = jasmine.createSpy('getAvailability').and.returnValue(of([]));
    TestBed.configureTestingModule({
      imports: [ReservationFormModalComponent],
      providers: [
        { provide: HttpClient, useValue: { get: () => of({}), post: () => of({}) } },
        { provide: ReservationsService, useValue: { getAvailability: () => of([]), getCalendar: () => of({}) } },
        { provide: ServiceStationsService, useValue: { getAvailability: availability, list: () => of({ data: [] }) } },
        { provide: ToastService, useValue: { warning: () => undefined, error: () => undefined } },
        { provide: PaymentMethodsService, useValue: {} },
      ],
    }).overrideComponent(ReservationFormModalComponent, { set: { template: '' } });
    const component = TestBed.createComponent(ReservationFormModalComponent).componentInstance;
    component.selectedService.set({ id: 9, requires_station: true });
    component.selectedDate.set('2026-11-12');
    component.stations.set(stations);
    return component;
  };

  it('keeps the time when the same station is picked again (S18)', () => {
    const c = create();
    c.selectStation(1);
    c.startTime.set('19:00');
    c.endTime.set('20:00');
    c.currentStep.set(c.confirmStep());

    c.selectStation(1);

    expect(c.startTime()).toBe('19:00');
    expect(c.endTime()).toBe('20:00');
    expect(c.currentStep()).toBe(c.confirmStep());
  });

  it('clears the time and returns to the time step when another station is picked (S18)', () => {
    const c = create();
    c.selectStation(1);
    c.startTime.set('19:00');
    c.endTime.set('20:00');
    c.currentStep.set(c.confirmStep());

    c.selectStation(2);

    expect(c.startTime()).toBe('');
    expect(c.currentStep()).toBe(c.slotStep());
    expect(availability).toHaveBeenCalled();
    expect(availability.calls.mostRecent().args[5]).toBe(2);
  });

  it('says a booked hour is reserved, not outside business hours (S19)', () => {
    const c = create();
    c.rawSlotsByDate.set({
      '2026-11-12': [
        { date: '2026-11-12', start_time: '19:00', end_time: '20:00', available_providers: [], total_available: 0, is_booked: true },
      ],
    });
    expect(c.validateTimeAgainstProviderSchedule('2026-11-12', '19:00', '20:00')).toBe('Ese horario ya está reservado');
  });

  it('keeps "fuera del horario de atención" for an hour with no slot (S19)', () => {
    const c = create();
    c.freeSlotsByDate.set({ '2026-11-12': [{ start: '08:00', end: '09:00' }] });
    c.rawSlotsByDate.set({
      '2026-11-12': [
        { date: '2026-11-12', start_time: '08:00', end_time: '09:00', available_providers: [], total_available: 1 },
      ],
    });
    expect(c.validateTimeAgainstProviderSchedule('2026-11-12', '23:00', '23:30')).toContain('fuera del horario de atención');
  });
});
