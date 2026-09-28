import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { KitchenTicket } from '../interfaces';
import { KitchenTicketsService } from './kitchen-tickets.service';
import { KdsSseService } from './kds-sse.service';

const ticket = (status: KitchenTicket['status'], updatedAt: string): KitchenTicket => ({
  id: 142,
  store_id: 10,
  order_id: 1358,
  status,
  fired_at: '2026-09-27T12:08:40.000Z',
  updated_at: updatedAt,
  items: [],
});

describe('KdsSseService confirmed ticket reconciliation', () => {
  let service: KdsSseService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        KdsSseService,
        { provide: KitchenTicketsService, useValue: {} },
      ],
    });
    service = TestBed.inject(KdsSseService);
  });

  afterEach(() => service.ngOnDestroy());

  it('moves a pending ticket to cancelled from the confirmed POST even without SSE', () => {
    service.applySnapshot([ticket('pending', '2026-09-27T12:08:40.000Z')]);
    service.reconcileConfirmedTicket(ticket('cancelled', '2026-09-27T12:26:03.313Z'));

    expect(service.tickets().map((row) => row.status)).toEqual(['cancelled']);
  });

  it('does not regress a newer SSE state when an older response arrives late', () => {
    service.applySnapshot([ticket('cancelled', '2026-09-27T12:26:03.313Z')]);
    service.reconcileConfirmedTicket(ticket('in_preparation', '2026-09-27T12:20:00.000Z'));

    expect(service.tickets().map((row) => row.status)).toEqual(['cancelled']);
  });
});
