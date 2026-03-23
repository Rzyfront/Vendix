import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class WithholdingTaxService {
  private http = inject(HttpClient);

  getConcepts(params?: any): Observable<any> {
    return this.http.get('/store/withholding-tax/concepts', { params });
  }

  createConcept(dto: any): Observable<any> {
    return this.http.post('/store/withholding-tax/concepts', dto);
  }

  updateConcept(id: number, dto: any): Observable<any> {
    return this.http.put(`/store/withholding-tax/concepts/${id}`, dto);
  }

  deleteConcept(id: number): Observable<any> {
    return this.http.delete(`/store/withholding-tax/concepts/${id}`);
  }

  getUvtValues(): Observable<any> {
    return this.http.get('/store/withholding-tax/uvt-values');
  }

  createUvtValue(dto: any): Observable<any> {
    return this.http.post('/store/withholding-tax/uvt-values', dto);
  }

  calculateWithholding(dto: any): Observable<any> {
    return this.http.post('/store/withholding-tax/calculate', dto);
  }

  getCertificate(supplierId: number, year: number): Observable<any> {
    return this.http.get(`/store/withholding-tax/certificates/${supplierId}`, { params: { year } });
  }

  getStats(): Observable<any> {
    return this.http.get('/store/withholding-tax/stats');
  }
}
