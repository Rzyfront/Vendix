import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { DataCollectionTemplate } from '../interfaces/data-collection-template.interface';

@Injectable({ providedIn: 'root' })
export class DataCollectionTemplatesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/store/data-collection/templates`;

  getAll(status?: string): Observable<DataCollectionTemplate[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    return this.http.get<any>(this.apiUrl, { params }).pipe(map(r => r.data));
  }

  getOne(id: number): Observable<DataCollectionTemplate> {
    return this.http.get<any>(`${this.apiUrl}/${id}`).pipe(map(r => r.data));
  }

  create(data: any): Observable<DataCollectionTemplate> {
    return this.http.post<any>(this.apiUrl, data).pipe(map(r => r.data));
  }

  update(id: number, data: any): Observable<DataCollectionTemplate> {
    return this.http.patch<any>(`${this.apiUrl}/${id}`, data).pipe(map(r => r.data));
  }

  duplicate(id: number): Observable<DataCollectionTemplate> {
    return this.http.post<any>(`${this.apiUrl}/${id}/duplicate`, {}).pipe(map(r => r.data));
  }

  assignProducts(id: number, productIds: number[]): Observable<DataCollectionTemplate> {
    return this.http.post<any>(`${this.apiUrl}/${id}/products`, { product_ids: productIds }).pipe(map(r => r.data));
  }
}
