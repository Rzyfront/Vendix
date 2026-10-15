import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { InvoiceDataComponent } from './invoice-data.component';
describe('public invoice holder page', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InvoiceDataComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ token: 'cfh1.fixture' }),
            },
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('restores processing from the capability without declaring fiscal success', () => {
    const fixture = TestBed.createComponent(InvoiceDataComponent);
    fixture.detectChanges();
    const request = http.expectOne((r) =>
      r.url.endsWith('/ecommerce/invoice-data/cfh1.fixture'),
    );
    expect(request.request.headers.has('Authorization')).toBeFalse();
    expect(request.request.headers.has('x-store-id')).toBeFalse();
    request.flush({
      data: {
        store: { name: 'Tienda' },
        status: 'processing',
        phase: 'credit_note_waiting',
        operation_id: 1,
      },
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.submitted()).toBeTrue();
    expect(fixture.componentInstance.completed()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Datos recibidos');
    fixture.destroy();
  });
  it('only completed is a successful invoice', () => {
    const fixture = TestBed.createComponent(InvoiceDataComponent);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith('/ecommerce/invoice-data/cfh1.fixture'))
      .flush({
        data: { status: 'completed', phase: 'completed', operation_id: 1 },
      });
    fixture.detectChanges();
    expect(fixture.componentInstance.completed()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Factura emitida');
    fixture.destroy();
  });
  it('treats expiry as terminal without loading staff catalogs', () => {
    const fixture = TestBed.createComponent(InvoiceDataComponent);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith('/ecommerce/invoice-data/cfh1.fixture'))
      .flush(
        { error_code: 'CF_HOLDER_LINK_EXPIRED' },
        { status: 410, statusText: 'Gone' },
      );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('venció');
    expect(fixture.componentInstance.fatalError()).toBeTrue();
    fixture.destroy();
  });
});
