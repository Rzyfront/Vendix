import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { ToastService } from '../../../../../../../shared/components';
import { storeToday } from '../../../../../../../shared/utils/date.util';
import { addDays } from '../../../../scheduled-orders/utils/ymd.util';
import { Booking, ServiceProvider } from '../../../interfaces/reservation.interface';
import { ReservationsService } from '../../../services/reservations.service';
import { ProviderDayAgendaComponent } from './provider-day-agenda.component';

const TZ = 'America/Bogota';

const provider = (id: number, name: string, sort: number): ServiceProvider =>
  ({ id, store_id: 1, employee_id: null, user_id: null, is_active: true, display_name: name, sort_order: sort }) as ServiceProvider;

const booking = (id: number, providerId: number | undefined, day: string, start: string): Booking =>
  ({
    id,
    date: day,
    start_time: start,
    end_time: '10:00',
    status: 'confirmed',
    provider_id: providerId,
    customer: { id: 1, first_name: 'Ana', last_name: 'Ruiz', email: '' },
    product: { id: 1, name: 'Corte' },
  }) as Booking;

function setup(bookingsFor: (day: string) => Booking[]) {
  const service = {
    getProviders: jasmine
      .createSpy('getProviders')
      .and.returnValue(of([provider(1, 'Laura', 1), provider(2, 'Pedro', 2)])),
    getCalendar: jasmine
      .createSpy('getCalendar')
      .and.callFake((from: string) => of({ [from]: bookingsFor(from) })),
  };
  const router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ReservationsService, useValue: service },
      { provide: StoreSettingsFacade, useValue: { timezone: () => TZ } },
      { provide: ToastService, useValue: { error: jasmine.createSpy('error') } },
      { provide: Router, useValue: router },
    ],
  });
  TestBed.overrideComponent(ProviderDayAgendaComponent, { set: { template: '', imports: [] } });
  const fixture = TestBed.createComponent(ProviderDayAgendaComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, service, router };
}

describe('ProviderDayAgendaComponent', () => {
  const today = storeToday(TZ);

  it('groups bookings into one column per provider', () => {
    const { component, service } = setup((day) => [
      booking(1, 1, day, '09:00'),
      booking(2, 2, day, '09:30'),
      booking(3, 1, day, '11:00'),
    ]);
    expect(service.getCalendar).toHaveBeenCalledWith(today, today);
    const cols = component.columns();
    expect(cols.map((c) => c.title)).toEqual(['Laura', 'Pedro']);
    expect(cols[0].count).toBe(2);
    expect(cols[1].count).toBe(1);
    expect(cols[0].byHour.get(9)?.length).toBe(1);
    expect(cols[0].byHour.get(11)?.length).toBe(1);
  });

  it('adds the "Sin asignar" column only when a booking has no provider', () => {
    const withUnassigned = setup((day) => [booking(1, undefined, day, '09:00')]);
    expect(withUnassigned.component.columns().map((c) => c.title)).toEqual([
      'Laura',
      'Pedro',
      'Sin asignar',
    ]);
    TestBed.resetTestingModule();
    const without = setup((day) => [booking(1, 1, day, '09:00')]);
    expect(without.component.columns().map((c) => c.title)).not.toContain('Sin asignar');
  });

  it('requests only the new day when navigating', () => {
    const { component, fixture, service } = setup(() => []);
    service.getCalendar.calls.reset();
    component.goToDay(1);
    fixture.detectChanges();
    expect(service.getCalendar).toHaveBeenCalledTimes(1);
    expect(service.getCalendar).toHaveBeenCalledWith(addDays(today, 1), addDays(today, 1));
    expect(service.getProviders).toHaveBeenCalledTimes(1);
    component.goToToday();
    fixture.detectChanges();
    expect(service.getCalendar).toHaveBeenCalledWith(today, today);
  });

  it('opens the reservations module when a booking is clicked', () => {
    const { component, router } = setup(() => []);
    component.openBooking(booking(1, 1, today, '09:00'));
    expect(router.navigate).toHaveBeenCalledWith(['/admin/reservations']);
  });
});
