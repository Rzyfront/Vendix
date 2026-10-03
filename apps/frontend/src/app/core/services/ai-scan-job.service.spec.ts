import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { AiScanJobService } from './ai-scan-job.service';
import { ERROR_MESSAGES } from '../utils/error-messages';
import { environment } from '../../../environments/environment';

describe('AiScanJobService', () => {
  const URL = '/api/x/scan/async';
  const POLL = `${environment.apiUrl}/ai-scan-jobs/job-1`;
  let service: AiScanJobService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AiScanJobService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  function enqueue() {
    http.expectOne(URL).flush({ success: true, data: { job_id: 'job-1' } });
  }

  it('emits the result once when the job completes', fakeAsync(() => {
    const out: unknown[] = [];
    service.enqueueAndWait<{ a: number }>(URL, new FormData()).subscribe((r) => out.push(r));
    enqueue();
    tick(0);
    http.expectOne(POLL).flush({ status: 'active' });
    tick(2500);
    http.expectOne(POLL).flush({ status: 'completed', result: { a: 1 } });
    tick(10_000);
    expect(out).toEqual([{ a: 1 }]);
  }));

  it('fails when job_id is missing', fakeAsync(() => {
    let err: Error | undefined;
    service.enqueueAndWait(URL, {}).subscribe({ error: (e) => (err = e) });
    http.expectOne(URL).flush({ success: true, data: {} });
    expect(err?.message).toBe('No se pudo iniciar el escaneo');
  }));

  it('maps a failed job code through ERROR_MESSAGES', fakeAsync(() => {
    let err: Error | undefined;
    service.enqueueAndWait(URL, {}).subscribe({ error: (e) => (err = e) });
    enqueue();
    tick(0);
    http.expectOne(POLL).flush({ status: 'failed', error: 'RUT_SCAN_AI_FAIL' });
    expect(err?.message).toBe(ERROR_MESSAGES['RUT_SCAN_AI_FAIL']);
  }));

  it('uses the generic message for unknown failure text', fakeAsync(() => {
    let err: Error | undefined;
    service.enqueueAndWait(URL, {}).subscribe({ error: (e) => (err = e) });
    enqueue();
    tick(0);
    http.expectOne(POLL).flush({ status: 'failed', error: 'boom raw' });
    expect(err?.message).toBe(
      'No se pudo procesar el documento. Intenta nuevamente.',
    );
  }));

  it('404 on poll gives the unavailable message without retries', fakeAsync(() => {
    let err: Error | undefined;
    service.enqueueAndWait(URL, {}).subscribe({ error: (e) => (err = e) });
    enqueue();
    tick(0);
    http.expectOne(POLL).flush({}, { status: 404, statusText: 'Not Found' });
    tick(5000);
    expect(err?.message).toBe(
      'El escaneo ya no está disponible. Vuelve a intentarlo.',
    );
  }));

  it('retries a transient 500 and then completes', fakeAsync(() => {
    const out: unknown[] = [];
    service.enqueueAndWait(URL, {}).subscribe((r) => out.push(r));
    enqueue();
    tick(0);
    http.expectOne(POLL).flush({}, { status: 500, statusText: 'Server Error' });
    tick(1000);
    http.expectOne(POLL).flush({ status: 'completed', result: { ok: true } });
    tick(10_000);
    expect(out).toEqual([{ ok: true }]);
  }));

  it('times out', fakeAsync(() => {
    let err: Error | undefined;
    service
      .enqueueAndWait(URL, {}, { timeoutMs: 4500, pollIntervalMs: 1000 })
      .subscribe({ error: (e) => (err = e) });
    enqueue();
    tick(0);
    http.match(POLL).forEach((r) => r.flush({ status: 'active' }));
    for (let i = 0; i < 4; i++) {
      tick(1000);
      http.match(POLL).forEach((r) => r.flush({ status: 'active' }));
    }
    tick(500);
    expect(err?.message).toBe('El escaneo tardó demasiado. Intenta nuevamente.');
  }));

  it('fires onStall once', fakeAsync(() => {
    let stalls = 0;
    service
      .enqueueAndWait(URL, {}, { onStall: () => stalls++, stallMs: 3000, pollIntervalMs: 1000 })
      .subscribe();
    enqueue();
    tick(0);
    http.expectOne(POLL).flush({ status: 'active' });
    for (let i = 0; i < 5; i++) {
      tick(1000);
      http.expectOne(POLL).flush({ status: 'active' });
    }
    expect(stalls).toBe(1);
    tick(1000);
    http.expectOne(POLL).flush({ status: 'completed', result: {} });
    tick(10_000);
    expect(stalls).toBe(1);
  }));
});
