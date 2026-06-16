import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  ConfirmScannedInvoiceDto,
} from '../interfaces/invoice-scanner.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class InvoiceScannerService {
  private readonly apiUrl = `${environment.apiUrl}/store/orders/purchase-orders`;

  constructor(private http: HttpClient) {}

  /**
   * Upload an invoice image/PDF for OCR scanning.
   *
   * Fase 4: `orderType` selects the backend AI app profile.
   *   - `retail` (default) → `invoice_ocr`
   *   - `ingredient` → `invoice_ocr_ingredient` (also extracts
   *     presentation / pack_size / uom_hint)
   *
   * Mixed-line orders are out of scope; the caller picks one profile
   * per scan.
   */
  scanInvoice(
    file: File,
    orderType: 'retail' | 'ingredient' = 'retail',
  ): Observable<ApiResponse<InvoiceScanResult>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ApiResponse<InvoiceScanResult>>(
      `${this.apiUrl}/scan?orderType=${orderType}`,
      formData,
    );
  }

  /**
   * Match extracted line items against existing products
   */
  matchProducts(
    scanResult: InvoiceScanResult,
  ): Observable<ApiResponse<InvoiceMatchResult>> {
    return this.http.post<ApiResponse<InvoiceMatchResult>>(
      `${this.apiUrl}/scan/match`,
      scanResult,
    );
  }

  /**
   * Confirm scanned invoice and create a purchase order
   */
  confirmAndCreate(
    data: ConfirmScannedInvoiceDto,
    file?: File,
  ): Observable<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('data', JSON.stringify(data));
    if (file) {
      formData.append('file', file);
    }
    return this.http.post<ApiResponse<any>>(
      `${this.apiUrl}/scan/confirm`,
      formData,
    );
  }
}
