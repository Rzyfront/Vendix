import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class IcaService {
  private http = inject(HttpClient);

  getRates(params?: any): Observable<any> {
    return this.http.get('/store/taxes/ica/rates', { params });
  }

  resolveStoreRate(): Observable<any> {
    return this.http.get('/store/taxes/ica/resolve');
  }

  calculateIca(dto: { amount: number; municipality_code: string; ciiu_code?: string }): Observable<any> {
    return this.http.post('/store/taxes/ica/calculate', dto);
  }

  getReport(period: string): Observable<any> {
    return this.http.get('/store/taxes/ica/report', { params: { period } });
  }
}
