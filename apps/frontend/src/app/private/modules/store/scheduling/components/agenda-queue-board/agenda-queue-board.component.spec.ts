import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { AgendaQueueBoardComponent } from './agenda-queue-board.component';
import { ReservationsService } from '../../../reservations/services/reservations.service';
import { ToastService } from '../../../../../../shared/components';
import { QueueBoard, QueueBoardRow } from '../../../reservations/interfaces/reservation.interface';

function row(over: Partial<QueueBoardRow>): QueueBoardRow {
  return {
    booking_id: 1,
    booking_number: 'BKG-1',
    customer_name: 'Ana Díaz',
    customer_first_name: 'Ana',
    customer_last_name: 'Díaz',
    service_name: 'Corte',
    provider_name: 'Laura',
    status: 'confirmed',
    checked_in: false,
    start_time: '11:00',
    end_time: '12:00',
    starts_at: '2026-11-25T16:00:00.000Z',
    arrival_at: null,
    minutes_to_start: 30,
    priority: 0,
    ...over,
  };
}

function board(over: Partial<QueueBoard> = {}): QueueBoard {
  return {
    day: '2026-11-25',
    generated_at: '2026-11-25T15:30:00.000Z',
    in_service: [],
    waiting: [],
    upcoming: [],
    ...over,
  };
}

describe('AgendaQueueBoardComponent', () => {
  let getQueueBoard: jasmine.Spy;
  let markAttending: jasmine.Spy;
  let toast: jasmine.SpyObj<ToastService>;

  function setup(initial: QueueBoard) {
    getQueueBoard = jasmine.createSpy('getQueueBoard').and.returnValue(of(initial));
    markAttending = jasmine.createSpy('markAttending').and.returnValue(of({ id: 1 }));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info']);
    TestBed.configureTestingModule({
      providers: [
        { provide: ReservationsService, useValue: { getQueueBoard, markAttending } },
        { provide: ToastService, useValue: toast },
      ],
    });
    return TestBed.createComponent(AgendaQueueBoardComponent).componentInstance;
  }

  it('elige como siguiente al primero en sala y deja el resto en la lista del monitor', () => {
    const component = setup(
      board({
        in_service: [row({ booking_id: 1, status: 'attending', checked_in: true })],
        waiting: [
          row({ booking_id: 2, status: 'arriving', checked_in: true, arrival_at: '2026-11-25T15:00:00.000Z' }),
          row({ booking_id: 3, status: 'arriving', checked_in: true, arrival_at: '2026-11-25T15:10:00.000Z' }),
        ],
        upcoming: [row({ booking_id: 4 }), row({ booking_id: 5 })],
      }),
    );
    component.ngOnInit();

    expect(component.next()?.booking_id).toBe(2);
    expect(component.following().map((r) => r.booking_id)).toEqual([3, 4, 5]);
    component.ngOnDestroy();
  });

  it('sin nadie en sala, el siguiente sale de la programación y no se repite en la lista', () => {
    const component = setup(
      board({
        upcoming: [row({ booking_id: 7, minutes_to_start: -20 }), row({ booking_id: 8 })],
      }),
    );
    component.ngOnInit();
    expect(component.next()?.booking_id).toBe(7);
    expect(component.following().map((r) => r.booking_id)).toEqual([8]);
    expect(component.timingLabel(component.next()!)).toBe('Atrasado 20 min');
    component.ngOnDestroy();
  });

  it('el monitor público usa primer nombre y la inicial del apellido', () => {
    const component = setup(board());
    component.ngOnInit();
    expect(
      component.publicName(
        row({ customer_name: 'Ana María Díaz Pérez', customer_first_name: 'Ana María', customer_last_name: 'Díaz Pérez' }),
      ),
    ).toBe('Ana D.');
    expect(
      component.publicName(
        row({ customer_name: 'Reserva #BKG-1', customer_first_name: null, customer_last_name: null }),
      ),
    ).toBe('Reserva');
    component.ngOnDestroy();
  });

  it('limpia el polling al destruirse', () => {
    const component = setup(board());
    const clearSpy = spyOn(globalThis, 'clearInterval').and.callThrough();
    component.ngOnInit();
    component.ngOnDestroy();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('llamar marca al cliente como en atención y recarga el tablero', () => {
    const component = setup(
      board({ waiting: [row({ booking_id: 9, status: 'arriving', checked_in: true })] }),
    );
    component.ngOnInit();
    expect(getQueueBoard).toHaveBeenCalledTimes(1);
    component.call(component.next()!);
    expect(markAttending).toHaveBeenCalledWith(9);
    expect(getQueueBoard).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });

  it('avisa con un toast cuando la llamada falla y refresca igual', () => {
    const component = setup(
      board({ waiting: [row({ booking_id: 9, status: 'arriving', checked_in: true })] }),
    );
    markAttending.and.returnValue(throwError(() => new Error('boom')));
    component.ngOnInit();
    component.call(component.next()!);
    expect(toast.error).toHaveBeenCalled();
    // Llamada inicial + el refresco del error.
    expect(getQueueBoard).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });

  it('una respuesta vieja del polling no pisa a la última', () => {
    const first = new Subject<QueueBoard>();
    const second = new Subject<QueueBoard>();
    getQueueBoard.and.returnValues(first, second);
    const component = setup(board());
    component.ngOnInit();
    component.refresh(false); // segunda petición en vuelo
    second.next(board({ day: '2026-11-25', waiting: [row({ booking_id: 50, status: 'arriving', checked_in: true })] }));
    first.next(board({ day: '2026-11-25', waiting: [row({ booking_id: 40, status: 'arriving', checked_in: true })] }));
    expect(component.next()?.booking_id).toBe(50);
    component.ngOnDestroy();
  });
});
