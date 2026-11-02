import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthFacade } from '../../core/store/auth/auth.facade';
import { HotelReservationStatusComponent } from '../../private/modules/ecommerce/pages/hotel-booking/hotel-reservation-status.component';
import { BookingPageService, OnlineCheckin } from './booking-page.service';
import { BookingReservationPageComponent } from './booking-reservation-page.component';

@Component({ selector: 'app-hotel-reservation-status', standalone: true, template: '' })
class StatusStub {}

describe('BookingReservationPageComponent (apps-module Fase 4)', () => {
  let fixture: ComponentFixture<BookingReservationPageComponent>;
  let booking: jasmine.SpyObj<BookingPageService>;
  let authenticated: BehaviorSubject<boolean>;

  const render = async (view: OnlineCheckin | Error, logged = true) => {
    booking.checkin.and.returnValue(view instanceof Error ? throwError(() => view) : of(view));
    authenticated.next(logged);
    fixture = TestBed.createComponent(BookingReservationPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    // The first check runs on a 0 ms timer (then every 5 s while unpaid).
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    booking = jasmine.createSpyObj('BookingPageService', ['checkin']);
    authenticated = new BehaviorSubject(true);
    TestBed.configureTestingModule({
      imports: [BookingReservationPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: BookingPageService, useValue: booking },
        { provide: AuthFacade, useValue: { isAuthenticated$: authenticated } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: '42' }) } },
        },
      ],
    });
    TestBed.overrideComponent(BookingReservationPageComponent, {
      remove: { imports: [HotelReservationStatusComponent] },
      add: { imports: [StatusStub] },
    });
  });

  it('reserva confirmada: muestra el botón al formulario de check-in del PMS', async () => {
    const el = await render({ state: 'available', path: '/pre-registro/tok', completed_at: null });

    expect(booking.checkin).toHaveBeenCalledWith(42);
    const link = el.querySelector('[data-testid="booking-checkin-link"]') as HTMLAnchorElement;
    expect(link.textContent).toContain('Hacer check-in en línea');
    expect(link.getAttribute('href')).toBe('/pre-registro/tok');
  });

  it('check-in completo: ofrece revisarlo', async () => {
    const el = await render({ state: 'completed', path: '/pre-registro/tok', completed_at: '2026-11-02' });
    expect(el.querySelector('[data-testid="booking-checkin-link"]')?.textContent).toContain('Revisar mi check-in');
  });

  it('pago pendiente: explica que se habilita al confirmar, sin botón', async () => {
    const el = await render({ state: 'not_confirmed', path: null, completed_at: null });
    expect(el.querySelector('[data-testid="booking-checkin"]')?.textContent).toContain('se confirme el pago');
    expect(el.querySelector('[data-testid="booking-checkin-link"]')).toBeNull();
  });

  it('sin sesión no consulta el check-in', async () => {
    const el = await render({ state: 'available', path: '/pre-registro/tok', completed_at: null }, false);
    expect(booking.checkin).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="booking-checkin"]')).toBeNull();
  });

  it('reserva ajena (404): no muestra tarjeta', async () => {
    const el = await render(new Error('404'));
    expect(el.querySelector('[data-testid="booking-checkin"]')).toBeNull();
  });
});
