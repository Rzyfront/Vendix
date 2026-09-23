import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminTablesEvent, AdminTablesSseService } from './admin-tables-sse.service';
import { TablesService } from './tables.service';

describe('AdminTablesSseService paid-session projection', () => {
  let service: AdminTablesSseService;
  let applyEvent: (event: AdminTablesEvent) => void;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: TablesService, useValue: { getFloorMap: () => of([]) } }],
    });
    service = TestBed.inject(AdminTablesSseService);
    applyEvent = (service as unknown as { applyEvent: (event: AdminTablesEvent) => void }).applyEvent.bind(service);
  });

  afterEach(() => service.disconnect());

  const snapshot = (paidAt: string | null): AdminTablesEvent => ({
    type: 'snapshot',
    data: {
      sessions: [{
        id: 7,
        store_id: 1,
        table_id: 3,
        order_id: 11,
        opened_at: '2026-09-22T10:00:00.000Z',
        paid_at: paidAt,
        guest_count: 2,
        table: null,
        order: { id: 11, state: 'completed', grand_total: 100, customer: null },
      }],
    },
  });

  it('hydrates a paid session from the initial snapshot', () => {
    applyEvent(snapshot('2026-09-22T11:00:00.000Z'));
    expect(service.tablesLive().get(7)?.payment_state).toBe('confirmed');
  });

  it('marks only the matching open session paid on the live event', () => {
    applyEvent(snapshot(null));
    applyEvent({
      type: 'session_paid',
      data: { table_session_id: 999, order_id: 12 },
      created_at: '2026-09-22T11:00:00.000Z',
    });
    expect(service.tablesLive().get(7)?.payment_state).toBe('none');
    applyEvent({
      type: 'session_paid',
      data: { table_session_id: 7, order_id: 11, payment_id: 21 },
      created_at: '2026-09-22T11:00:00.000Z',
    });
    expect(service.tablesLive().get(7)?.payment_state).toBe('confirmed');
  });
});
