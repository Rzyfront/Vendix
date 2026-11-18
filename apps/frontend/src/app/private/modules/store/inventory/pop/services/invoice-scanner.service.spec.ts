import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';

import { InvoiceScannerService } from './invoice-scanner.service';

/**
 * QUI-1020: la espera de las colas `invoice-scan` e `invoice-revalidate` ya no
 * vive aquí sino en `AiScanJobService` (backoff, reenganche, errores por
 * categoría). El servicio solo expone las URLs y el cuerpo del encolado.
 */
describe('InvoiceScannerService — URLs de las colas de IA', () => {
  let service: InvoiceScannerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [InvoiceScannerService, { provide: HttpClient, useValue: {} }],
    });
    service = TestBed.inject(InvoiceScannerService);
  });

  it('el encolado del escaneo lleva el perfil en orderType', () => {
    expect(service.scanEnqueueUrl('ingredient')).toMatch(
      /\/store\/orders\/purchase-orders\/scan\/async\?orderType=ingredient$/,
    );
    expect(service.scanEnqueueUrl()).toMatch(/orderType=retail$/);
  });

  it('el estado del escaneo y de la revalidación cuelgan de su job', () => {
    expect(service.scanStatusUrl('7')).toMatch(
      /\/purchase-orders\/scan\/async\/7$/,
    );
    expect(service.revalidateEnqueueUrl()).toMatch(
      /\/purchase-orders\/scan\/revalidate$/,
    );
    expect(service.revalidateStatusUrl('9')).toMatch(
      /\/purchase-orders\/scan\/revalidate\/9$/,
    );
  });

  it('el archivo del escaneo viaja en el campo file', () => {
    const file = new File(['x'], 'f.pdf', { type: 'application/pdf' });
    expect(service.scanFormData(file).get('file')).toBe(file);
  });
});
