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
   * Upload an invoice image/PDF for OCR scanning
   */
  scanInvoice(file: File): Observable<ApiResponse<InvoiceScanResult>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ApiResponse<InvoiceScanResult>>(
      `${this.apiUrl}/scan`,
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
