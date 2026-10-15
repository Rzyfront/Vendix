import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideStore } from '@ngrx/store';
import { provideMockActions } from '@ngrx/effects/testing';
import { Subject, of } from 'rxjs';
import { InvoiceHolderChangeComponent } from './invoice-holder-change.component';
import {
  InvoiceHolderChangeService,
  HolderChangeOperation,
} from '../../services/invoice-holder-change.service';
import { CustomersService } from '../../../customers/services/customers.service';
import { Store } from '@ngrx/store';
import * as InvoiceActions from '../../state/actions/invoicing.actions';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
describe('durable invoice holder wizard', () => {
  const actions = new Subject<import('@ngrx/store').Action>();
  const operation = {
    id: 1,
    original_invoice_id: 10,
    original_order_id: 20,
    phase: 'credit_note_waiting',
    run_status: 'waiting',
    can_retry: false,
  } as HolderChangeOperation;
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [InvoiceHolderChangeComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideStore(),
        provideMockActions(() => actions),
        {
          provide: CurrencyFormatService,
          useValue: { format: (value: unknown) => String(value) },
        },
        {
          provide: InvoiceHolderChangeService,
          useValue: {
            context: () =>
              of({ eligible: true, can_remake: true, can_release: true }),
            operation: () => of(operation),
          },
        },
        {
          provide: CustomersService,
          useValue: { getCustomers: () => of({ data: [] }) },
        },
      ],
    }),
  );
  it('does not allow selecting a new customer while the credit note is waiting', () => {
    const f = TestBed.createComponent(InvoiceHolderChangeComponent);
    f.componentRef.setInput('invoiceId', 10);
    f.detectChanges();
    f.componentInstance.operation.set(operation);
    expect(f.componentInstance.canChooseCustomer()).toBeFalse();
    f.componentInstance.operation.set({
      ...operation,
      phase: 'order_released',
    });
    expect(f.componentInstance.canChooseCustomer()).toBeTrue();
    f.destroy();
  });
  it('dispatches one command on double click and waits for a correlated result', () => {
    const f = TestBed.createComponent(InvoiceHolderChangeComponent);
    f.componentRef.setInput('invoiceId', 10);
    f.detectChanges();
    const dispatch = spyOn(TestBed.inject(Store), 'dispatch');
    f.componentInstance.reason.setValue('Cambio solicitado por el comprador');
    f.componentInstance.begin('remake');
    f.componentInstance.begin('remake');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.busy()).toBeTrue();
    const action = dispatch.calls.mostRecent().args[0] as unknown as ReturnType<
      typeof InvoiceActions.holderChangeCommand
    >;
    actions.next(
      InvoiceActions.holderChangeCommandSuccess({
        requestId: action.requestId,
        operation,
      }),
    );
    expect(f.componentInstance.busy()).toBeFalse();
    expect(f.componentInstance.operation()?.id).toBe(1);
    f.destroy();
  });
});
