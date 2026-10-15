import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { InvoiceDataRequestsPageComponent } from './invoice-data-requests-page.component';
import { InvoiceDataRequestService } from '../../services/invoice-data-request.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  InvoiceDataRequestRow,
  InvoiceDataRequestSummary,
} from '../../interfaces/invoice-data-request.interface';
import { ApiResponse } from '../../interfaces/invoice.interface';
describe('invoice requests demand and durable retry', () => {
  let service: jasmine.SpyObj<InvoiceDataRequestService>;
  let toast: jasmine.SpyObj<ToastService>;
  beforeEach(() => {
    service = jasmine.createSpyObj('InvoiceDataRequestService', [
      'list',
      'summary',
      'process',
    ]);
    service.list.and.returnValue(
      of({ data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 1 } }),
    );
    service.summary.and.returnValue(
      of({
        data: {
          pending: 0,
          submitted: 0,
          processing: 0,
          completed: 0,
          expired: 0,
          failed: 0,
          total: 0,
        },
      } as ApiResponse<InvoiceDataRequestSummary>),
    );
    toast = jasmine.createSpyObj('ToastService', [
      'success',
      'warning',
      'error',
    ]);
    TestBed.configureTestingModule({
      imports: [InvoiceDataRequestsPageComponent],
      providers: [
        { provide: InvoiceDataRequestService, useValue: service },
        { provide: ToastService, useValue: toast },
        {
          provide: CurrencyFormatService,
          useValue: { format: (n: unknown) => String(n) },
        },
      ],
    });
    TestBed.overrideComponent(InvoiceDataRequestsPageComponent, {
      set: { template: '', imports: [] },
    });
  });
  it('defaults list and summary to requested visibility and keeps the same universe on search', () => {
    const f = TestBed.createComponent(InvoiceDataRequestsPageComponent);
    const c = f.componentInstance;
    expect(service.list.calls.mostRecent().args[0]?.visibility).toBe(
      'requested',
    );
    expect(service.summary).toHaveBeenCalledWith('', 'requested');
    c.searchValue.set('FE-1');
    c.onSearch('FE-1');
    expect(service.summary).toHaveBeenCalledWith('FE-1', 'requested');
    c.onFilterChange({ visibility: 'all' });
    expect(service.list.calls.mostRecent().args[0]?.visibility).toBe('all');
    expect(service.summary).toHaveBeenCalledWith('FE-1', 'all');
    f.destroy();
  });
  it('allows a recoverable failed row and describes waiting as pending, not emitted', () => {
    service.process.and.returnValue(
      of({
        data: {
          id: 17,
          status: 'processing',
          phase: 'credit_note_waiting',
          credit_note_id: 90,
        },
      } as ApiResponse<InvoiceDataRequestRow>),
    );
    const f = TestBed.createComponent(InvoiceDataRequestsPageComponent);
    f.componentInstance.process({
      id: 17,
      status: 'failed',
      can_retry: true,
    } as InvoiceDataRequestRow);
    expect(service.process).toHaveBeenCalledWith(17);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalled();
    f.destroy();
  });
  it('shows success only for an accepted replacement', () => {
    service.process.and.returnValue(
      of({
        data: { id: 17, phase: 'fiscal_completed', new_invoice_id: 91 },
      } as ApiResponse<InvoiceDataRequestRow>),
    );
    const f = TestBed.createComponent(InvoiceDataRequestsPageComponent);
    f.componentInstance.process({
      id: 17,
      status: 'failed',
      can_retry: true,
    } as InvoiceDataRequestRow);
    expect(toast.success).toHaveBeenCalled();
    f.destroy();
  });
});
