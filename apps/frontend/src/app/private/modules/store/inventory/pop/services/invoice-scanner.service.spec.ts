import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Subject, defer, of, throwError } from 'rxjs';

import { InvoiceScannerService } from './invoice-scanner.service';
import {
  InvoiceRevalidateJobStatus,
  InvoiceRevalidateRequest,
} from '../interfaces/invoice-scanner.interface';

describe('InvoiceScannerService.revalidateAndWait — polling (QUI-855)', () => {
  let service: InvoiceScannerService;
  const body = {} as InvoiceRevalidateRequest;
  const completed: InvoiceRevalidateJobStatus = {
    status: 'completed',
    result: { consolidated: {}, report: {} },
  } as unknown as InvoiceRevalidateJobStatus;

  // El proyecto corre zoneless (sin zone-testing): fakeAsync no existe.
  let clock: jasmine.Clock;
  beforeEach(() => {
    clock = jasmine.clock();
    clock.install();
    clock.mockDate(new Date());
    TestBed.configureTestingModule({
      providers: [InvoiceScannerService, { provide: HttpClient, useValue: {} }],
    });
    service = TestBed.inject(InvoiceScannerService);
    spyOn(service, 'revalidate').and.returnValue(of('job-1'));
  });
  afterEach(() => clock.uninstall());

  it('reintenta un fallo transitorio del GET de estado (2 veces, 1 s) y termina', () => {
    let calls = 0;
    // Cold como `http.get`: cada suscripción (cada reintento) vuelve a «pedir».
    spyOn(service, 'getRevalidateStatus').and.callFake(() =>
      defer(() => {
        calls++;
        return calls < 3
          ? throwError(() => new HttpErrorResponse({ status: 503 }))
          : of(completed);
      }),
    );
    let result: unknown;
    let error: unknown;
    service.revalidateAndWait(body).subscribe({
      next: (r) => (result = r),
      error: (e) => (error = e),
    });
    clock.tick(0);
    expect(calls).toBe(1);
    clock.tick(1000);
    expect(calls).toBe(2);
    clock.tick(1000);
    expect(calls).toBe(3);
    expect(error).toBeUndefined();
    expect(result).toBeDefined();
  });

  it('tras 3 fallos seguidos (1 intento + 2 reintentos) propaga el error', () => {
    let calls = 0;
    spyOn(service, 'getRevalidateStatus').and.callFake(() =>
      defer(() => {
        calls++;
        return throwError(() => new HttpErrorResponse({ status: 503 }));
      }),
    );
    let error: unknown;
    service.revalidateAndWait(body).subscribe({ error: (e) => (error = e) });
    clock.tick(0);
    clock.tick(2000);
    expect(calls).toBe(3);
    expect(error).toBeDefined();
  });

  it('un 404 (job evictado) NO se reintenta y se traduce al mensaje en español', () => {
    const spy = spyOn(service, 'getRevalidateStatus').and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    let error: Error | undefined;
    service.revalidateAndWait(body).subscribe({ error: (e) => (error = e) });
    clock.tick(5000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(error?.message).toContain('ya no está disponible');
  });

  it('un GET lento no se cancela cuando llega el siguiente tick (exhaustMap)', () => {
    const slow$ = new Subject<InvoiceRevalidateJobStatus>();
    const spy = spyOn(service, 'getRevalidateStatus').and.returnValue(slow$);
    let result: unknown;
    service.revalidateAndWait(body).subscribe((r) => (result = r));
    clock.tick(0);
    expect(spy).toHaveBeenCalledTimes(1);
    // Pasan dos ticks (2 s c/u) con el GET aún en vuelo: no se lanza otro.
    clock.tick(4000);
    expect(spy).toHaveBeenCalledTimes(1);
    // El GET original responde y su resultado SÍ se entrega.
    slow$.next(completed);
    expect(result).toBeDefined();
  });
});
