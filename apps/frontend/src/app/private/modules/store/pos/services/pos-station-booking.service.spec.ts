import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  PosStationBookingService,
  findUnscheduledStationLine,
} from './pos-station-booking.service';
import { environment } from '../../../../../../environments/environment';

// QUI-970: pre-pay guard for station services. Pure function — no TestBed.
describe('findUnscheduledStationLine (QUI-970)', () => {
  const stationProduct: any = { id: 968, name: 'Cambio de aceite', requires_station: true };
  const plainProduct: any = { id: 10, name: 'Shampoo', requires_station: false };

  it('returns null when the cart has no station lines', () => {
    expect(
      findUnscheduledStationLine({ items: [{ product: plainProduct }] } as any),
    ).toBeNull();
  });

  it('asks to schedule when a station line has no booking block', () => {
    const msg = findUnscheduledStationLine({
      items: [{ product: stationProduct, quantity: 1 }],
      pendingBookings: [],
    } as any);
    expect(msg).toContain('Agenda "Cambio de aceite"');
    expect(msg).toContain('estación');
  });

  it('asks to pick a station when the block has none', () => {
    const msg = findUnscheduledStationLine({
      items: [
        {
          product: stationProduct,
          quantity: 1,
          booking: { date: '2026-11-02', start_time: '09:00', end_time: '09:30' },
        },
      ],
      pendingBookings: [],
    } as any);
    expect(msg).toContain('sin estación');
  });

  it('asks to re-confirm when the block has no persisted booking', () => {
    const msg = findUnscheduledStationLine({
      items: [
        {
          product: stationProduct,
          quantity: 1,
          booking: {
            date: '2026-11-02',
            start_time: '09:00',
            end_time: '09:30',
            station_id: 1,
            booking_id: 0,
          },
        },
      ],
      pendingBookings: [],
    } as any);
    expect(msg).toContain('aún no tiene reserva creada');
  });

  it('accepts a station line with a persisted booking block', () => {
    expect(
      findUnscheduledStationLine({
        items: [
          {
            product: stationProduct,
            quantity: 1,
            booking: {
              date: '2026-11-02',
              start_time: '09:00',
              end_time: '09:30',
              station_id: 1,
              booking_id: 38,
            },
          },
        ],
        pendingBookings: [],
      } as any),
    ).toBeNull();
  });

  it('accepts a station line covered by pendingBookings (adopted flow)', () => {
    expect(
      findUnscheduledStationLine({
        items: [{ product: stationProduct, quantity: 1 }],
        pendingBookings: [{ id: 38, product_id: 968 } as any],
      } as any),
    ).toBeNull();
  });

  it('rejects quantity > 1 on station lines (one booking per unit)', () => {
    const msg = findUnscheduledStationLine({
      items: [{ product: stationProduct, quantity: 2 }],
      pendingBookings: [],
    } as any);
    expect(msg).toContain('cantidad 1');
  });
});

// QUI-970 review #1046: persisted station bookings — specialist changes
// reach the booking, and POS-created orderless bookings are cancelled
// when their line leaves the cart unpaid.
describe('PosStationBookingService (QUI-970)', () => {
  const api = environment.apiUrl;
  const stationProduct: any = { id: 968, name: 'Cambio de aceite', requires_station: true };
  let service: PosStationBookingService;
  let http: HttpTestingController;

  const block = {
    product_id: 968,
    provider_id: 7,
    station_id: 3,
    date: '2026-11-02',
    start_time: '09:00',
    end_time: '09:30',
  };

  beforeEach(() => {
    localStorage.removeItem('vendix_pos_station_bookings');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PosStationBookingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem('vendix_pos_station_bookings');
  });

  function createBooking(id: number): void {
    service.persistScheduledStationBooking(block, 5).subscribe();
    http
      .expectOne({ method: 'POST', url: `${api}/store/reservations` })
      .flush({ data: { id } });
  }

  it('sends the new specialist when rescheduling an existing booking', () => {
    service
      .persistScheduledStationBooking({ ...block, booking_id: 41, provider_id: 9 })
      .subscribe();
    const req = http.expectOne({
      method: 'PATCH',
      url: `${api}/store/reservations/41/reschedule`,
    });
    expect(req.request.body).toEqual({
      station_id: 3,
      date: '2026-11-02',
      start_time: '09:00',
      end_time: '09:30',
      provider_id: 9,
    });
    req.flush({ data: { id: 41 } });
  });

  it('tracks only the bookings it created', () => {
    createBooking(41);
    const items: any[] = [
      { id: 'a', product: stationProduct, booking: { booking_id: 41 } },
      { id: 'b', product: stationProduct, booking: { booking_id: 99 } },
    ];
    expect(service.posCreatedBookingIds(items)).toEqual([41]);
  });

  it('cancels an orphan booking via PATCH :id/cancel and forgets it', () => {
    createBooking(41);
    service.cancelOrphanBookings([41]).subscribe();
    http
      .expectOne({ method: 'PATCH', url: `${api}/store/reservations/41/cancel` })
      .flush({ data: { id: 41, status: 'cancelled' } });
    expect(
      service.posCreatedBookingIds([
        { id: 'a', product: stationProduct, booking: { booking_id: 41 } } as any,
      ]),
    ).toEqual([]);
  });

  it('never cancels after the cart reset (charged bookings)', () => {
    createBooking(41);
    service.forgetAll();
    expect(
      service.posCreatedBookingIds([
        { id: 'a', product: stationProduct, booking: { booking_id: 41 } } as any,
      ]),
    ).toEqual([]);
  });
});
