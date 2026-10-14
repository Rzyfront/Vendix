import { Observable, Subject } from 'rxjs';
import type { Invoice } from './interfaces/invoice.interface';
import { InvoiceNoteSourceLoader } from './utils/invoice-note-source-loader.util';

describe('InvoiceNoteSourceLoader', () => {
  const fullInvoice = {
    id: 73,
    invoice_type: 'sales_invoice',
    status: 'accepted',
    invoice_items: [{ id: 731, quantity: 2, unit_price: 100 }],
    total_amount: 200,
  } as Invoice;

  it('loads and validates the full source, reporting loading callbacks', () => {
    const loader = new InvoiceNoteSourceLoader();
    const response = new Subject<{ data?: Invoice | null }>();
    const request = jasmine.createSpy('request').and.returnValue(response);
    const loading = jasmine.createSpy('loading');
    const success = jasmine.createSpy('success');
    const error = jasmine.createSpy('error');

    loader.loadFullSource(73, request, { loading, success, error });
    expect(request).toHaveBeenCalledOnceWith(73);
    expect(loading).toHaveBeenCalledOnceWith(true);

    response.next({ data: fullInvoice });
    expect(response.observed).toBeFalse();

    expect(loading).toHaveBeenCalledTimes(2);
    expect(loading).toHaveBeenCalledWith(false);
    expect(success).toHaveBeenCalledOnceWith(fullInvoice);
    expect(error).not.toHaveBeenCalled();
  });

  it('ignores a stale response after a newer source load starts', () => {
    const loader = new InvoiceNoteSourceLoader();
    const requests: Subject<{ data?: Invoice | null }>[] = [];
    const request = jasmine.createSpy('request').and.callFake(() => {
      const subject = new Subject<{ data?: Invoice | null }>();
      requests.push(subject);
      return subject;
    });
    const firstSuccess = jasmine.createSpy('firstSuccess');
    const secondSuccess = jasmine.createSpy('secondSuccess');

    loader.loadFullSource(73, request, {
      loading: jasmine.createSpy('firstLoading'),
      success: firstSuccess,
      error: jasmine.createSpy('firstError'),
    });
    loader.loadFullSource(74, request, {
      loading: jasmine.createSpy('secondLoading'),
      success: secondSuccess,
      error: jasmine.createSpy('secondError'),
    });

    const secondInvoice = { ...fullInvoice, id: 74 } as Invoice;
    requests[1].next({ data: secondInvoice });
    requests[0].next({ data: fullInvoice });

    expect(secondSuccess).toHaveBeenCalledOnceWith(secondInvoice);
    expect(firstSuccess).not.toHaveBeenCalled();
  });

  it('cancels a pending load, ends loading, and ignores any late result', () => {
    const loader = new InvoiceNoteSourceLoader();
    const response = new Subject<{ data?: Invoice | null }>();
    const loading = jasmine.createSpy('loading');
    const success = jasmine.createSpy('success');
    const error = jasmine.createSpy('error');

    loader.loadFullSource(73, () => response, { loading, success, error });
    loader.cancel();
    response.next({ data: fullInvoice });

    expect(loading).toHaveBeenCalledWith(true);
    expect(loading).toHaveBeenCalledWith(false);
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('rejects a response whose invoice id does not match the requested source', () => {
    const loader = new InvoiceNoteSourceLoader();
    const loading = jasmine.createSpy('loading');
    const success = jasmine.createSpy('success');
    const error = jasmine.createSpy('error');

    loader.loadFullSource(
      73,
      () => new Observable((subscriber) => subscriber.next({ data: { ...fullInvoice, id: 999 } })),
      { loading, success, error },
    );

    expect(loading).toHaveBeenCalledWith(false);
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnceWith(jasmine.stringMatching('factura completa'));
  });

  it('rejects an incomplete invoice without an invoice_items array', () => {
    const loader = new InvoiceNoteSourceLoader();
    const success = jasmine.createSpy('success');
    const error = jasmine.createSpy('error');

    loader.loadFullSource(
      73,
      () => new Observable((subscriber) => subscriber.next({ data: { ...fullInvoice, invoice_items: undefined } as Invoice })),
      { loading: jasmine.createSpy('loading'), success, error },
    );

    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnceWith(jasmine.stringMatching('factura completa'));
  });

  it('passes request failures to the error callback and closes loading', () => {
    const loader = new InvoiceNoteSourceLoader();
    const failure = new Error('request failed');
    const loading = jasmine.createSpy('loading');
    const error = jasmine.createSpy('error');

    loader.loadFullSource(
      73,
      () => new Observable((subscriber) => subscriber.error(failure)),
      { loading, success: jasmine.createSpy('success'), error },
    );

    expect(loading).toHaveBeenCalledWith(true);
    expect(loading).toHaveBeenCalledWith(false);
    expect(error).toHaveBeenCalledOnceWith(failure);
  });
});
