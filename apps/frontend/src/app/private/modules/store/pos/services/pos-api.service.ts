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

  // QUI-649 — POS adopts the order auto-created by the reservation backend
  // (POST /store/reservations returns `booking.order` populated). Items added
  // by the cashier after adoption are pushed here, not into a local cart.
  updateOrderItems(orderId: string | number, items: any[]): Observable<any> {
    return this.http.put(`${this.apiUrl}/store/orders/${orderId}/items`, { items });
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
    return this.http.post(`${this.apiUrl}/store/orders/${id}/flow/cancel`, {
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

  // QUI-649 — when the POS has adopted an existing order (linkedOrderId is
  // set after a reservation flow), the cashier charges THAT order via the
  // "Process payment for existing order" endpoint. We do NOT call
  // `createOrder` because that would create a second order; the server
  // already has the auto-created one.
  processPaymentForExistingOrder(paymentData: {
    orderId: number;
    amount: number;
    currency: string;
    storePaymentMethodId: number;
    storeId: number;
    customerId?: number;
    /** QUI-728 (E.1) — `CreatePaymentDto.bank_account_id`, en snake_case. */
    bank_account_id?: number;
    metadata?: Record<string, any>;
    returnUrl?: string;
    cancelUrl?: string;
  }): Observable<any> {
    return this.http.post(`${this.apiUrl}/store/payments`, paymentData);
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

  // Promotion endpoints
  getActivePromotions(): Observable<any> {
    return this.http.get(`${this.apiUrl}/store/promotions/active`);
  }

  validateCoupon(
    code: string,
    cartSubtotal?: number,
    customerId?: number,
    productIds?: number[],
    categoryIds?: number[],
    items?: Array<{ product_id?: number; category_ids?: number[]; line_total: number }>,
  ): Observable<any> {
    return this.http.post(`${this.apiUrl}/store/coupons/validate`, {
      code,
      cart_subtotal: cartSubtotal,
      customer_id: customerId,
      product_ids: productIds,
      category_ids: categoryIds,
      items,
    });
  }
}
