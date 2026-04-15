import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { MetadataField, MetadataValue } from '../interfaces/metadata-field.interface';

@Injectable({ providedIn: 'root' })
export class MetadataFieldsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/store/metadata-fields`;
  private valuesUrl = `${environment.apiUrl}/store/metadata-values`;

  getFields(entityType?: string): Observable<MetadataField[]> {
    let params = new HttpParams();
    if (entityType) params = params.set('entity_type', entityType);
    return this.http.get<any>(this.apiUrl, { params }).pipe(map(r => r.data));
  }

  getField(id: number): Observable<MetadataField> {
    return this.http.get<any>(`${this.apiUrl}/${id}`).pipe(map(r => r.data));
  }

  createField(data: Partial<MetadataField>): Observable<MetadataField> {
    return this.http.post<any>(this.apiUrl, data).pipe(map(r => r.data));
  }

  updateField(id: number, data: Partial<MetadataField>): Observable<MetadataField> {
    return this.http.patch<any>(`${this.apiUrl}/${id}`, data).pipe(map(r => r.data));
  }

  toggleField(id: number, isActive: boolean): Observable<MetadataField> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/toggle`, { is_active: isActive }).pipe(map(r => r.data));
  }

  deleteField(id: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`).pipe(map(r => r.data));
  }

  // Values
  getValues(entityType: string, entityId: number): Observable<MetadataValue[]> {
    return this.http.get<any>(`${this.valuesUrl}/${entityType}/${entityId}`).pipe(map(r => r.data));
  }

  setValues(entityType: string, entityId: number, values: { field_id: number; value_text?: string; value_number?: number; value_date?: string; value_bool?: boolean; value_json?: any }[]): Observable<any> {
    return this.http.post<any>(this.valuesUrl, { entity_type: entityType, entity_id: entityId, values }).pipe(map(r => r.data));
  }
}
