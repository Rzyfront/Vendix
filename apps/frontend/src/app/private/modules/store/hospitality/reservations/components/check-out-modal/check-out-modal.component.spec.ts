import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { CheckOutModalComponent } from './check-out-modal.component';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import { PaymentMethodsCatalogService } from '../../../../../../../shared/services/payment-methods-catalog.service';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { LodgingHousekeepingService } from '../../../housekeeping/services/housekeeping.service';
import { LodgingReservation } from '../../interfaces/reservation.interface';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { signal } from '@angular/core';

/**
 * Agenda unificada (F3) — closing the check-out offers the room's clean in
 * the same flow, and only after the reservation left.
 */
describe('CheckOutModalComponent — limpieza sugerida al cerrar', () => {
  let fixture: ComponentFixture<CheckOutModalComponent>;
  let component: CheckOutModalComponent;
  let reservations: jasmine.SpyObj<LodgingReservationsService>;
  let housekeeping: jasmine.SpyObj<LodgingHousekeepingService>;

  const folio = {
    total: 100,
    paid: 100,
    balance: 0,
    pending_nights: 0,
    verified_current: true,
    verified_at: null,
  };
  const reservation = {
    id: 9,
    reservation_number: 'R-0009',
    status: 'checked_in',
    customer: { first_name: 'Eva', last_name: 'Ruiz' },
  } as unknown as LodgingReservation;

  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const suggestionHost = () =>
    document.querySelector('app-checkout-clean-suggestion') ??
    (fixture.nativeElement as HTMLElement).querySelector('app-checkout-clean-suggestion');

  const owner = signal(false);
  const permissions = signal<string[]>(['store:lodging:front_desk:operate']);
  const authFacade = {
    ownerFlag: owner,
    hasPermission: (p: string) => permissions().includes(p),
  };

  beforeEach(async () => {
    owner.set(false);
    permissions.set(['store:lodging:front_desk:operate']);
    reservations = jasmine.createSpyObj<LodgingReservationsService>('LodgingReservationsService', [
      'listKeys',
      'getFolio',
      'getFolioSplit',
      'checkOut',
      'getFolioInvoicePdf',
      'returnKey',
    ]);
    reservations.listKeys.and.returnValue(of([]));
    reservations.getFolio.and.returnValue(of(folio as any));
    reservations.getFolioSplit.and.returnValue(of(null as any));
    reservations.checkOut.and.returnValue(of({ folio, invoice: null } as any));

    housekeeping = jasmine.createSpyObj<LodgingHousekeepingService>('LodgingHousekeepingService', [
      'checkoutCleanSuggestion',
      'assignCheckoutClean',
    ]);
    housekeeping.checkoutCleanSuggestion.and.returnValue(
      of({ reservation_id: 9, business_date: '2026-11-23', staff: [], rooms: [] }),
    );

    TestBed.configureTestingModule({
      imports: [CheckOutModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: LodgingReservationsService, useValue: reservations },
        { provide: LodgingHousekeepingService, useValue: housekeeping },
        { provide: AuthFacade, useValue: authFacade },
        { provide: PaymentMethodsCatalogService, useValue: { getEnabledMethods: () => of([]) } },
        { provide: CurrencyFormatService, useValue: { format: (n: number) => `$${n}` } },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'warning']),
        },
      ],
    });
    fixture = TestBed.createComponent(CheckOutModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('reservation', reservation);
    await render();
  });

  afterEach(() => fixture.destroy());

  it('no ofrece la limpieza antes de confirmar el check-out', () => {
    expect(component.cleanReservationId()).toBeNull();
    expect(housekeeping.checkoutCleanSuggestion).not.toHaveBeenCalled();
  });

  it('al cerrar el check-out ofrece la tarea de limpieza de la habitación', async () => {
    component.confirm();
    await render();

    expect(reservations.checkOut).toHaveBeenCalled();
    expect(component.cleanReservationId()).toBe(9);
    expect(housekeeping.checkoutCleanSuggestion).toHaveBeenCalledWith(9);
    expect(suggestionHost()).not.toBeNull();
  });

  it('no muestra el paso a quien cierra la cuenta sin permiso para asignar limpieza', async () => {
    permissions.set(['store:lodging:folio:close']);
    component.confirm();
    await render();

    expect(reservations.checkOut).toHaveBeenCalled();
    expect(component.cleanReservationId()).toBeNull();
    expect(housekeeping.checkoutCleanSuggestion).not.toHaveBeenCalled();
  });

  it('el owner o quien tiene housekeeping:assign sí lo ve', async () => {
    permissions.set([]);
    owner.set(true);
    expect(component.canAssignClean()).toBeTrue();
    owner.set(false);
    permissions.set(['store:lodging:housekeeping:assign']);
    expect(component.canAssignClean()).toBeTrue();
  });
});
