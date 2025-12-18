import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class PosApiService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // Customer endpoints
  createCustomer(customerData: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/store/customers`, customerData);
  }

  searchCustomers(params: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/customers`, { params });
  }

  getCustomerById(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/customers/${id}`);
  }

  updateCustomer(id: string, data: any): Observable<any> {
    return this.http.patch(`${this.apiUrl}/store/customers/${id}`, data);
  }

  // Product endpoints
  searchProducts(params: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/products`, { params });
  }

  getProductById(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/products/${id}`);
  }

  getProductByBarcode(barcode: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/products/by-barcode/${barcode}`);
  }

  getProductBySku(sku: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/products/by-sku/${sku}`);
  }

  updateStock(productId: string, data: any): Observable<any> {
    return this.http.patch(
      `${this.apiUrl}/store/products/${productId}/stock`,
      data,
    );
  }

  // Order endpoints
  createOrder(orderData: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/store/orders`, orderData);
  }

  createDraftOrder(orderData: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/store/orders/draft`, orderData);
  }

  updateOrder(id: string, data: any): Observable<any> {
    return this.http.patch(`${this.apiUrl}/store/orders/${id}`, data);
  }

  getOrderById(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/orders/${id}`);
  }

  getOrderByNumber(orderNumber: string): Observable<any> {
    return this.http.get(
      `${this.apiUrl}/store/orders/by-number/${orderNumber}`,
    );
  }

  searchOrders(params: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/orders`, { params });
  }

  cancelOrder(id: string, reason?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/store/orders/${id}/cancel`, {
      reason,
    });
  }

  refundOrder(id: string, reason?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/store/orders/${id}/refund`, {
      reason,
    });
  }

  getOrderStats(params?: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/orders/stats`, { params });
  }

  // Payment endpoints
  processPayment(paymentData: any): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/store/payments/with-order`,
      paymentData,
    );
  }

  getPaymentMethods(): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/payments/methods`);
  }

  refundPayment(paymentId: string, reason?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/store/payments/${paymentId}/refund`, {
      reason,
    });
  }

  getTransactionHistory(params?: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/payments/transactions`, {
      params,
    });
  }
}
