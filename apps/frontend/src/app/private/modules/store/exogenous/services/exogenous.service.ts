import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ExogenousService {
  private http = inject(HttpClient);

  getReports(params?: any): Observable<any> {
    return this.http.get('/store/exogenous/reports', { params });
  }

  generateReport(dto: { fiscal_year: number; format_code: string }): Observable<any> {
    return this.http.post('/store/exogenous/reports/generate', dto);
  }

  getReport(id: number): Observable<any> {
    return this.http.get(`/store/exogenous/reports/${id}`);
  }

  getReportLines(id: number, page = 1, limit = 50): Observable<any> {
    return this.http.get(`/store/exogenous/reports/${id}/lines`, { params: { page, limit } });
  }

  submitReport(id: number): Observable<any> {
    return this.http.post(`/store/exogenous/reports/${id}/submit`, {});
  }

  validateYear(year: number): Observable<any> {
    return this.http.get(`/store/exogenous/validate/${year}`);
  }

  getStats(year: number): Observable<any> {
    return this.http.get(`/store/exogenous/stats/${year}`);
  }
}
