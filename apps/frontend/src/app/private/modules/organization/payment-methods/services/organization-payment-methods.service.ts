import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  PaymentMethod,
  UpdatePaymentMethodsRequest,
} from '../interfaces/payment-methods.interface';

@Injectable({
  providedIn: 'root',
})
export class OrganizationPaymentMethodsService {
  private readonly apiBaseUrl = `${environment.apiUrl}/organization/payment-policies`;

  constructor(private http: HttpClient) {}

  getAvailableMethods(): Observable<PaymentMethod[]> {
    return this.http
      .get<PaymentMethod[]>(`${this.apiBaseUrl}/available-methods`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching available payment methods:', error);
          return throwError(() => error);
        }),
      );
  }

  updatePaymentMethods(request: UpdatePaymentMethodsRequest): Observable<any> {
    return this.http.put(`${this.apiBaseUrl}/payment-methods`, request).pipe(
      catchError((error) => {
        console.error('Error updating payment methods:', error);
        return throwError(() => error);
      }),
    );
  }

  formatAmount(amount?: number): string {
    if (!amount) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  }

  getPaymentMethodTypeColor(type: string): string {
    const colorMap: Record<string, string> = {
      cash: '#10b981',
      card: '#3b82f6',
      paypal: '#f59e0b',
      bank_transfer: '#8b5cf6',
      voucher: '#ef4444',
    };
    return colorMap[type] || '#6b7280';
  }

  getPaymentMethodTypeLabel(type: string): string {
    const labelMap: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      paypal: 'PayPal',
      bank_transfer: 'Transferencia',
      voucher: 'Voucher',
    };
    return labelMap[type] || type;
  }
}
