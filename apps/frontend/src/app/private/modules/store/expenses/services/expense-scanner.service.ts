import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse } from '../interfaces/expense.interface';
import { ExpenseScanResponse } from '../interfaces/expense-scanner.interface';

@Injectable({
  providedIn: 'root',
})
export class ExpenseScannerService {
  private http = inject(HttpClient);

  /**
   * Escanea una factura de gasto con IA y devuelve el resultado + categoría
   * sugerida por matching fuzzy.
   */
  scanInvoice(file: File): Observable<ApiResponse<ExpenseScanResponse>> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<ApiResponse<ExpenseScanResponse>>(
      `${environment.apiUrl}/store/expenses/scan`,
      fd,
    );
  }
}