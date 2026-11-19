import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type {
  CustomerDataSheet,
  DataSheetUploadResult,
  DataSheetValueInput,
} from '../components/customer-data-sheet/customer-data-sheet.interface';

@Injectable({ providedIn: 'root' })
export class CustomerDataSheetService {
  private readonly http = inject(HttpClient);

  private url(customerId: number): string {
    return `${environment.apiUrl}/store/customers/${customerId}/crm/data-sheet`;
  }

  get(customerId: number): Observable<CustomerDataSheet> {
    return this.http
      .get<{ data: CustomerDataSheet }>(this.url(customerId))
      .pipe(map((r) => r.data));
  }

  setTemplate(
    customerId: number,
    templateId: number | null,
  ): Observable<CustomerDataSheet> {
    return this.http
      .put<{ data: CustomerDataSheet }>(`${this.url(customerId)}/template`, {
        template_id: templateId,
      })
      .pipe(map((r) => r.data));
  }

  saveValues(
    customerId: number,
    values: DataSheetValueInput[],
  ): Observable<CustomerDataSheet> {
    return this.http
      .put<{ data: CustomerDataSheet }>(`${this.url(customerId)}/values`, {
        values,
      })
      .pipe(map((r) => r.data));
  }

  upload(customerId: number, file: File): Observable<DataSheetUploadResult> {
    const body = new FormData();
    body.append('file', file);
    return this.http
      .post<{ data: DataSheetUploadResult }>(`${this.url(customerId)}/upload`, body)
      .pipe(map((r) => r.data));
  }
}
