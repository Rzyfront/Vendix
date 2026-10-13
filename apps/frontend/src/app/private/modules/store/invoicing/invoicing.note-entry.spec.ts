import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { Observable, of, Subject } from 'rxjs';
import { Invoice } from './interfaces/invoice.interface';
import { InvoicingService } from './services/invoicing.service';
import { InvoicingComponent } from './invoicing.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import { ToastService } from '../../../../shared/components';
import { VexiUiHostRegistry } from '../../../../core/services/vexi-ui-host.registry';
import { FiscalRequirementsService } from '../../../../shared/services/fiscal-requirements.service';

describe('InvoicingComponent note entry', () => {
  let fixture: ComponentFixture<InvoicingComponent>;
  let service: jasmine.SpyObj<InvoicingService>;
  let requests: Subject<{ success: boolean; data: Invoice }>[];
  let toast: jasmine.SpyObj<ToastService>;
  let dispatch: jasmine.Spy;

  const listRow = { id: 73 } as Invoice;
  const fullInvoice = {
    id: 73,
    invoice_type: 'sales_invoice',
    status: 'accepted',
    invoice_items: [{ id: 731, quantity: 2, unit_price: 100 }],
    total_amount: 200,
  } as Invoice;

  beforeEach(async () => {
    requests = [];
    service = jasmine.createSpyObj<InvoicingService>('InvoicingService', ['getInvoice']);
    service.getInvoice.and.callFake((id: number) => {
      const request = new Subject<{ success: boolean; data: Invoice }>();
      requests.push(request);
      return request.asObservable() as Observable<{ success: boolean; data: Invoice }>;
    });
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error']);
    dispatch = jasmine.createSpy('dispatch');

    await TestBed.configureTestingModule({
      imports: [InvoicingComponent],
      providers: [
        {
          provide: Store,
          useValue: {
            select: jasmine.createSpy('select').and.returnValue(of([])),
            dispatch,
          },
        },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: InvoicingService, useValue: service },
        { provide: ToastService, useValue: toast },
        { provide: CurrencyFormatService, useValue: {
          loadCurrency: () => Promise.resolve(null),
          format: (value: number) => String(value),
          currencyDecimals: () => 2,
          currencyFormatStyle: () => 'comma_dot',
        } },
        { provide: Actions, useValue: new Subject<unknown>() },
        { provide: VexiUiHostRegistry, useValue: { register: jasmine.createSpy(), unregister: jasmine.createSpy() } },
        { provide: FiscalRequirementsService, useValue: {
          close: jasmine.createSpy(),
          isOpen: signal(false),
          requirements: signal([]),
          handleAction: jasmine.createSpy(),
        } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    TestBed.overrideComponent(InvoicingComponent, { set: { imports: [] } });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(InvoicingComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('loads the full source before opening the replacement note modal', async () => {
    const component = fixture.componentInstance;
    component.isDetailModalOpen.set(true);
    component.openCreditNoteModal(listRow);

    expect(service.getInvoice).toHaveBeenCalledWith(73);
    expect(component.creditNoteLoading()).toBeTrue();
    expect(component.isDetailModalOpen()).toBeFalse();
    expect(component.isCreditNoteModalOpen()).toBeFalse();
    expect(component.creditNoteSourceInvoice()).toBeNull();

    requests[0].next({ success: true, data: fullInvoice });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.creditNoteLoading()).toBeFalse();
    expect(component.creditNoteSourceInvoice()).toBe(fullInvoice);
    expect(component.isCreditNoteModalOpen()).toBeTrue();
    expect(fixture.nativeElement.querySelector('vendix-invoice-note-create')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('vendix-credit-note-create')).toBeNull();
  });

  it('ignores the late result for a previous invoice when another source is opened', () => {
    const component = fixture.componentInstance;
    component.openCreditNoteModal(listRow);
    const priorRequest = requests[0];
    component.openCreditNoteModal({ id: 74 } as Invoice);
    const currentRequest = requests[1];
    const otherInvoice = { ...fullInvoice, id: 74 } as Invoice;

    currentRequest.next({ success: true, data: otherInvoice });
    priorRequest.next({ success: true, data: fullInvoice });

    expect(component.creditNoteSourceInvoice()).toBe(otherInvoice);
    expect(component.isCreditNoteModalOpen()).toBeTrue();
    expect(component.creditNoteLoading()).toBeFalse();
  });

  it('cancels a pending source load and rejects a mismatched or incomplete response', () => {
    const component = fixture.componentInstance;
    component.openCreditNoteModal(listRow);
    const canceledRequest = requests[0];
    component.cancelCreditNoteSourceLoad();
    canceledRequest.next({ success: true, data: fullInvoice });
    expect(component.creditNoteSourceInvoice()).toBeNull();
    expect(component.isCreditNoteModalOpen()).toBeFalse();

    component.openCreditNoteModal(listRow);
    requests[1].next({ success: true, data: { ...fullInvoice, id: 999 } as Invoice });
    expect(component.isCreditNoteModalOpen()).toBeFalse();
    expect(component.creditNoteLoadError()).toContain('factura completa');
    expect(toast.error).toHaveBeenCalled();
  });

  it('surfaces load errors and refreshes the list when the note modal closes', () => {
    const component = fixture.componentInstance;
    component.openCreditNoteModal(listRow);
    requests[0].error({ error: { message: 'No se pudo consultar la factura.' } });

    expect(component.creditNoteLoading()).toBeFalse();
    expect(component.creditNoteLoadError()).toBeTruthy();
    expect(toast.error).toHaveBeenCalled();

    component.openCreditNoteModal(listRow);
    requests[1].next({ success: true, data: fullInvoice });
    const dispatchCountBeforeClose = dispatch.calls.count();
    component.onCreditNoteModalOpenChange(false);
    expect(component.creditNoteSourceInvoice()).toBeNull();
    expect(dispatch.calls.count()).toBe(dispatchCountBeforeClose + 2);
  });
});
