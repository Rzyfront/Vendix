import { Component, input, output, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { UnitTypesService } from '../../../rooms/services/unit-types.service';
import { ReservationDetailModalComponent } from '../../components/reservation-detail-modal/reservation-detail-modal.component';
import { ReservationFormModalComponent } from '../../components/reservation-form-modal/reservation-form-modal.component';
import { HospitalityReservationsListComponent } from '../../components/reservations-list/reservations-list.component';
import { FrontDeskBoard, FrontDeskRow } from '../../interfaces/reservation.interface';
import { hospitalityReservationsRoutes } from '../../routes/reservations.routes';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import {
  HospitalityFrontDeskPageComponent,
  toFrontDeskTab,
} from './front-desk-page.component';

@Component({ selector: 'app-hospitality-reservations-list', standalone: true, template: 'LISTA-RESERVAS' })
class ReservationsListStub {
  readonly changed = output<void>();
}

@Component({ selector: 'app-reservation-form-modal', standalone: true, template: '' })
class FormModalStub {
  readonly isOpen = input(false);
  readonly walkIn = input(false);
  readonly unitTypes = input<unknown[]>([]);
  readonly isOpenChange = output<boolean>();
  readonly saved = output<unknown>();
}

@Component({ selector: 'app-reservation-detail-modal', standalone: true, template: '' })
class DetailModalStub {
  readonly reservationId = input<number | null>(null);
  readonly startWith = input<string | null>(null);
  readonly closed = output<void>();
  readonly changed = output<void>();
}

function row(id: number, guest: string): FrontDeskRow {
  return {
    id,
    reservation_number: `R-${id}`,
    guest_name: guest,
    rooms: '101',
    arrival_date: '2026-11-23',
    departure_date: '2026-11-25',
    adults: 2,
    children: 0,
    status: 'confirmed',
    balance: null,
    folio_id: null,
    unassigned_rooms: 0,
    keys_out: 0,
    registered_guests: 0,
  } as unknown as FrontDeskRow;
}

const BOARD = {
  business_date: '2026-11-23',
  arrivals: [row(1, 'Ana Llegada'), row(2, 'Beto Llegada')],
  departures: [row(3, 'Carla Salida')],
  in_house: [],
} as unknown as FrontDeskBoard;

describe('HospitalityFrontDeskPageComponent — Recepción con la pestaña Reservas (agenda F2)', () => {
  let harness: RouterTestingHarness;
  let reservations: jasmine.SpyObj<LodgingReservationsService>;

  beforeEach(async () => {
    reservations = jasmine.createSpyObj<LodgingReservationsService>('LodgingReservationsService', [
      'frontDesk',
      'checkIn',
    ]);
    reservations.frontDesk.and.returnValue(of(BOARD));

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          { path: 'admin/hospitality/front-desk', component: HospitalityFrontDeskPageComponent },
          {
            path: 'admin/hospitality/reservations',
            loadChildren: () => Promise.resolve(hospitalityReservationsRoutes),
          },
        ]),
        { provide: LodgingReservationsService, useValue: reservations },
        { provide: UnitTypesService, useValue: { list: () => of([]) } },
        { provide: ToastService, useValue: { success: jasmine.createSpy(), error: jasmine.createSpy() } },
        { provide: CurrencyFormatService, useValue: { format: (value: number) => `$${value}` } },
      ],
    });
    TestBed.overrideComponent(HospitalityFrontDeskPageComponent, {
      remove: {
        imports: [
          HospitalityReservationsListComponent,
          ReservationFormModalComponent,
          ReservationDetailModalComponent,
        ],
      },
      add: { imports: [ReservationsListStub, FormModalStub, DetailModalStub] },
    });
    harness = await RouterTestingHarness.create();
  });

  const text = () => harness.routeNativeElement!.textContent ?? '';
  const url = () => TestBed.inject(Router).url;

  it('toFrontDeskTab: Reservas por defecto y ante valores desconocidos', () => {
    expect(toFrontDeskTab(null)).toBe('reservations');
    expect(toFrontDeskTab('otra')).toBe('reservations');
    expect(toFrontDeskTab('arrivals')).toBe('arrivals');
    expect(toFrontDeskTab('in_house')).toBe('in_house');
  });

  it('abre en la pestaña Reservas (principal) y escribe ?tab=reservations en la URL', async () => {
    const page = await harness.navigateByUrl(
      '/admin/hospitality/front-desk',
      HospitalityFrontDeskPageComponent,
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(page.tab()).toBe('reservations');
    expect(url()).toBe('/admin/hospitality/front-desk?tab=reservations');
    expect(text()).toContain('LISTA-RESERVAS');
    // The board stats belong to the board tabs, not to Reservas.
    expect(text()).not.toContain('Saldo por cobrar');
  });

  it('ordena las pestañas: Reservas, Llegadas, Salidas, En casa (con conteos del tablero)', async () => {
    const page = await harness.navigateByUrl(
      '/admin/hospitality/front-desk',
      HospitalityFrontDeskPageComponent,
    );
    expect(page.tabs().map((tab) => tab.id)).toEqual([
      'reservations',
      'arrivals',
      'departures',
      'in_house',
    ]);
    expect(page.tabs().map((tab) => tab.label)).toEqual([
      'Reservas',
      'Llegadas (2)',
      'Salidas (1)',
      'En casa (0)',
    ]);
  });

  it('?tab=arrivals muestra el tablero de llegadas, sin la lista de reservas', async () => {
    const page = await harness.navigateByUrl(
      '/admin/hospitality/front-desk?tab=arrivals',
      HospitalityFrontDeskPageComponent,
    );
    harness.detectChanges();

    expect(page.tab()).toBe('arrivals');
    expect(text()).not.toContain('LISTA-RESERVAS');
    expect(text()).toContain('Saldo por cobrar');
    expect(page.rows().map((r) => r.guest_name)).toEqual(['Ana Llegada', 'Beto Llegada']);
  });

  it('cambiar de pestaña actualiza ?tab= y el contenido', async () => {
    const page = await harness.navigateByUrl(
      '/admin/hospitality/front-desk',
      HospitalityFrontDeskPageComponent,
    );
    page.onTab('departures');
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(url()).toBe('/admin/hospitality/front-desk?tab=departures');
    expect(page.rows().map((r) => r.guest_name)).toEqual(['Carla Salida']);
  });

  it('un cambio en la pestaña Reservas recarga el tablero (conteos de las pestañas)', async () => {
    await harness.navigateByUrl('/admin/hospitality/front-desk', HospitalityFrontDeskPageComponent);
    harness.detectChanges();
    const calls = reservations.frontDesk.calls.count();

    const list = harness.fixture.debugElement.query(
      (el) => el.componentInstance instanceof ReservationsListStub,
    );
    (list.componentInstance as ReservationsListStub).changed.emit();

    expect(reservations.frontDesk.calls.count()).toBe(calls + 1);
  });

  it('la URL vieja /admin/hospitality/reservations redirige a Recepción → Reservas', async () => {
    const page = await harness.navigateByUrl(
      '/admin/hospitality/reservations',
      HospitalityFrontDeskPageComponent,
    );
    harness.detectChanges();

    expect(url()).toBe('/admin/hospitality/front-desk?tab=reservations');
    expect(page.tab()).toBe('reservations');
    expect(text()).toContain('LISTA-RESERVAS');
  });
});
