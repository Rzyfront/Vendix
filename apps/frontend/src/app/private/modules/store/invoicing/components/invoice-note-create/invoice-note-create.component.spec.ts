import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { Observable, Subject, of } from 'rxjs';
import { Invoice, InvoiceItem, InvoiceNoteContext, InvoiceNoteContextLine } from '../../interfaces/invoice.interface';
import { InvoicingService } from '../../services/invoicing.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { InvoiceNoteCreateComponent } from './invoice-note-create.component';
import { createCreditNoteSuccess } from '../../state/actions/invoicing.actions';

const sourceItem: InvoiceItem = {
  id: 41, invoice_id: 7, product_name: 'Producto de origen', quantity: 2,
  unit_price: 100, discount_amount: 10, tax_amount: 1.27, total_amount: 7.94,
  unit_code: 'KGM', price_unit_quantity: 12,
};
const invoice = {
  id: 7, invoice_number: 'FV-7', total_amount: 7.94,
  subtotal_amount: 16.67, discount_amount: 10, tax_amount: 1.27,
  invoice_items: [sourceItem],
} as Invoice;
const contextLine: InvoiceNoteContextLine = {
  source_invoice_item_id: 41, description: 'Producto de origen', quantity: 2,
  unit_price: 100, discount_amount: 10, unit_code: 'KGM', price_unit_quantity: 12,
  is_inclusive: false,
  taxes: [{ tax_name: 'IVA', tax_type: 'iva', tax_rate: 19, rate_basis: 'percent', is_inclusive: false }],
  remaining_quantity: 1, remaining_base: 3.33, remaining_total: 3.96,
};
function context(note_type: InvoiceNoteContext['note_type'], invoice_id = 7): InvoiceNoteContext {
  return { invoice_id, note_type, items: [contextLine], warnings: [] };
}

describe('InvoiceNoteCreateComponent source-aware editing', () => {
  let fixture: ComponentFixture<InvoiceNoteCreateComponent>;
  let service: jasmine.SpyObj<InvoicingService>;
  let requests: Subject<{ success: boolean; data: InvoiceNoteContext }>[];
  let actions: Subject<unknown>;
  let dispatch: jasmine.Spy;

  beforeEach(async () => {
    requests = [];
    actions = new Subject<unknown>();
    service = jasmine.createSpyObj<InvoicingService>('InvoicingService', ['getInvoiceNoteContext']);
    service.getInvoiceNoteContext.and.callFake((_id: number, _noteType: 'credit_note' | 'debit_note') => {
      const request = new Subject<{ success: boolean; data: InvoiceNoteContext }>();
      requests.push(request);
      return request.asObservable() as Observable<{ success: boolean; data: InvoiceNoteContext }>;
    });
    dispatch = jasmine.createSpy('dispatch');
    await TestBed.configureTestingModule({
      imports: [InvoiceNoteCreateComponent],
      providers: [
        { provide: InvoicingService, useValue: service },
        { provide: Store, useValue: { dispatch } },
        { provide: Actions, useValue: actions },
        { provide: CurrencyFormatService, useValue: {
          loadCurrency: () => Promise.resolve(null),
          format: (value: number) => String(value),
          currencyDecimals: () => 2,
          currencyFormatStyle: () => 'comma_dot',
        } },
      ],
    }).compileComponents();
  });

  function open(type: 'credit' | 'debit' = 'credit') {
    fixture = TestBed.createComponent(InvoiceNoteCreateComponent);
    fixture.componentRef.setInput('invoice', invoice);
    fixture.componentInstance.noteType.set(type);
    fixture.componentInstance.isOpen.set(true);
    fixture.detectChanges();
  }

  it('loads context by invoice and note type and ignores a canceled stale response', () => {
    open('credit');
    expect(service.getInvoiceNoteContext).toHaveBeenCalledWith(7, 'credit_note');
    fixture.componentInstance.noteType.set('debit');
    fixture.detectChanges();
    expect(service.getInvoiceNoteContext).toHaveBeenCalledWith(7, 'debit_note');

    requests[0].next({ success: true, data: context('credit_note') });
    expect(fixture.componentInstance.noteContext()).toBeNull();
    requests[1].next({ success: true, data: context('debit_note') });
    expect(fixture.componentInstance.noteContext()?.note_type).toBe('debit_note');
    fixture.destroy();
  });

  it('keeps editable commercial values, captured source, and server allowance defaults', () => {
    open();
    requests[0].next({ success: true, data: context('credit_note') });
    const component = fixture.componentInstance;
    component.setScope('partial');
    component.toggleLine(sourceItem, { target: { checked: true } } as unknown as Event);
    component.setLineValue(sourceItem, 'quantity', '0.6667');
    expect(component.lineControl(41, 'discount_amount').value).toBe(3.33);
    expect(component.selections()[0].discount_amount).toBeUndefined();
    component.setLineValue(sourceItem, 'quantity', '1');
    expect(component.selections()[0].discount_amount).toBe(5);
    component.setLineValue(sourceItem, 'unit_price', '1500');
    component.setLineValue(sourceItem, 'discount_amount', '3');
    component.setLineValue(sourceItem, 'quantity', '0.5');
    component.setUnitCode(sourceItem, 'LTR');

    expect(component.selections()[0]).toEqual(jasmine.objectContaining({
      quantity: 0.5, unit_price: 1500, discount_amount: 3, unit_code: 'LTR',
      discount_overridden: true,
      context: jasmine.objectContaining({ source_invoice_item_id: 41 }),
    }));
    component.retryContext();
    fixture.detectChanges();
    requests[1].next({ success: true, data: context('credit_note') });
    expect(component.selections()[0]).toEqual(jasmine.objectContaining({
      quantity: 0.5, unit_price: 1500, discount_amount: 3, unit_code: 'LTR',
    }));
    expect(component.canSubmit()).toBeFalse(); // Concept/motivo required; editable data remains.
    fixture.destroy();
  });

  it('limits credit quantity to source balance but leaves debit quantity uncapped', () => {
    open('credit');
    requests[0].next({ success: true, data: context('credit_note') });
    expect(fixture.componentInstance.rows()[0].quantityLimit).toBe(1);
    fixture.componentInstance.noteType.set('debit');
    fixture.detectChanges();
    requests[1].next({ success: true, data: context('debit_note') });
    expect(fixture.componentInstance.rows()[0].quantityLimit).toBeNull();
    fixture.destroy();
  });

  it('cannot dispatch a duplicate create while the first request is pending', () => {
    open();
    requests[0].next({ success: true, data: context('credit_note') });
    const component = fixture.componentInstance;
    component.setScope('partial');
    component.toggleLine(sourceItem, { target: { checked: true } } as unknown as Event);
    component.setLineValue(sourceItem, 'quantity', '1');
    component.setLineValue(sourceItem, 'unit_price', '1500');
    component.setLineValue(sourceItem, 'discount_amount', '3');
    component.setUnitCode(sourceItem, 'LTR');
    component.noteForm.patchValue({ conceptCode: '1', reason: 'Devolución' });
    component.onSubmit();
    component.onSubmit();
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.calls.mostRecent().args[0];
    expect(action.dto.items).toEqual([{
      source_invoice_item_id: 41,
      quantity: 1,
      unit_price: 1500,
      discount_amount: 3,
      unit_code: 'LTR',
    }]);
    fixture.destroy();
  });

  it('keeps total-note creation available when source context cannot resolve partial lines', () => {
    open();
    requests[0].error({ error: {
      error_code: 'INVOICING_NOTE_SOURCE_001',
      message: 'Unresolved source',
      details: {},
    } });
    const component = fixture.componentInstance;
    component.noteForm.patchValue({ conceptCode: '2', reason: 'Anulación' });
    expect(component.contextError()).toBeTruthy();
    expect(component.scope()).toBe('total');
    expect(component.canSubmit()).toBeTrue();
    fixture.destroy();
  });

  it('resets draft lifecycle on invoice change and ignores an older create success', () => {
    open('credit');
    requests[0].next({ success: true, data: context('credit_note') });
    const component = fixture.componentInstance;
    component.noteForm.patchValue({ conceptCode: '1', reason: 'Devolución' });
    component.onSubmit();
    const oldNote = {
      ...invoice, id: 101, invoice_type: 'credit_note', related_invoice_id: 7,
    } as Invoice;
    actions.next(createCreditNoteSuccess({ invoice: oldNote }));
    expect(component.createdNote()?.id).toBe(101);

    const otherInvoice = {
      ...invoice,
      id: 8,
      invoice_number: 'FV-8',
      invoice_items: [{ ...sourceItem, invoice_id: 8 }],
    } as Invoice;
    fixture.componentRef.setInput('invoice', otherInvoice);
    fixture.detectChanges();
    expect(component.createdNote()).toBeNull();
    expect(component.submitting()).toBeFalse();
    expect(component.issuing()).toBeFalse();
    expect(component.noteForm.controls.reason.value).toBe('');
    expect(service.getInvoiceNoteContext).toHaveBeenCalledWith(8, 'credit_note');

    requests[1].next({ success: true, data: context('credit_note', 8) });
    component.noteForm.patchValue({ conceptCode: '1', reason: 'Devolución' });
    component.onSubmit();
    actions.next(createCreditNoteSuccess({ invoice: oldNote }));
    expect(component.createdNote()).toBeNull();
    expect(component.submitting()).toBeTrue();
    actions.next(createCreditNoteSuccess({
      invoice: { ...oldNote, id: 102, related_invoice_id: 8 } as Invoice,
    }));
    expect(component.createdNote()?.id).toBe(102);
    fixture.destroy();
  });
});
