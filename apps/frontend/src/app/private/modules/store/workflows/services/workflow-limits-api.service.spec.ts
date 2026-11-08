import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../../../environments/environment';
import { WorkflowLimitsApiService, WorkflowUsageSnapshot } from './workflow-limits-api.service';

describe('WorkflowLimitsApiService (P7.1)', () => {
  it('usage() reads GET store/workflows/usage and unwraps data', () => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    const snapshot: WorkflowUsageSnapshot = {
      period: '2026-11',
      metrics: [{ key: 'monthly_instances', used: 1, cap: 10, percent: 10, state: 'ok' }],
    };
    let got: WorkflowUsageSnapshot | undefined;
    TestBed.inject(WorkflowLimitsApiService)
      .usage()
      .subscribe((r) => (got = r));
    const req = TestBed.inject(HttpTestingController).expectOne(`${environment.apiUrl}/store/workflows/usage`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: snapshot });
    expect(got).toEqual(snapshot);
  });
});
