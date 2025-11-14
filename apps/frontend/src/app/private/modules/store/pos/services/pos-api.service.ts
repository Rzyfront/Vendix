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
    return this.http.post(`${this.apiUrl}/customers`, customerData);
  }

  searchCustomers(params: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/customers`, { params });
  }

  getCustomerById(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/customers/${id}`);
  }

  updateCustomer(id: string, data: any): Observable<any> {
    return this.http.patch(`${this.apiUrl}/customers/${id}`, data);
  }

  // Product endpoints
  searchProducts(params: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/products`, { params });
  }

  getProductById(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/products/${id}`);
  }

  getProductByBarcode(barcode: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/products/by-barcode/${barcode}`);
  }

  getProductBySku(sku: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/products/by-sku/${sku}`);
  }

  updateStock(productId: string, data: any): Observable<any> {
    return this.http.patch(`${this.apiUrl}/products/${productId}/stock`, data);
  }

  // Order endpoints
  createOrder(orderData: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/orders`, orderData);
  }

  createDraftOrder(orderData: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/orders/draft`, orderData);
  }

  updateOrder(id: string, data: any): Observable<any> {
    return this.http.patch(`${this.apiUrl}/orders/${id}`, data);
  }

  getOrderById(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/orders/${id}`);
  }

  getOrderByNumber(orderNumber: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/orders/by-number/${orderNumber}`);
  }

  searchOrders(params: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/orders`, { params });
  }

  cancelOrder(id: string, reason?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/orders/${id}/cancel`, { reason });
  }

  refundOrder(id: string, reason?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/orders/${id}/refund`, { reason });
  }

  getOrderStats(params?: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/orders/stats`, { params });
  }

  // Payment endpoints
  processPayment(paymentData: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/payments/with-order`, paymentData);
  }

  getPaymentMethods(): Observable<any> {
    return this.http.get(`${this.apiUrl}/payments/methods`);
  }

  refundPayment(paymentId: string, reason?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/payments/${paymentId}/refund`, {
      reason,
    });
  }

  getTransactionHistory(params?: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/payments/transactions`, { params });
  }
}
