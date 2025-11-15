import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { PosApiService } from './pos-api.service';
import {
  PosCustomer,
  CreatePosCustomerRequest,
  SearchCustomersRequest,
  PaginatedCustomersResponse,
  CustomerValidationError,
} from '../models/customer.model';
import {
  PosOrder,
  CreatePosOrderRequest,
  UpdatePosOrderRequest,
  ProcessPaymentRequest,
  ProcessPaymentResponse,
  OrderSearchRequest,
  PaginatedOrdersResponse,
  OrderStats,
} from '../models/order.model';
import {
  PaymentMethod,
  PaymentRequest,
  Transaction,
} from '../models/payment.model';
import { Product } from './pos-product.service';

@Injectable({
  providedIn: 'root',
})
export class PosIntegrationService {
  constructor(private posApi: PosApiService) {}

  // Customer Integration
  createCustomer(request: CreatePosCustomerRequest): Observable<PosCustomer> {
    return this.posApi.createCustomer(request).pipe(
      map((response: any) => this.mapApiCustomerToPosCustomer(response)),
      catchError((error) => {
        const validationErrors = this.mapApiErrorsToValidationErrors(error);
        if (validationErrors.length > 0) {
          return throwError(
            () => new Error(validationErrors.map((e) => e.message).join(', ')),
          );
        }
        return throwError(() => error);
      }),
    );
  }

  searchCustomers(
    request: SearchCustomersRequest,
  ): Observable<PaginatedCustomersResponse> {
    const params = {
      query: request.query || '',
      limit: request.limit?.toString() || '20',
      offset: request.offset?.toString() || '0',
    };

    return this.posApi
      .searchCustomers(params)
      .pipe(map((response: any) => this.mapApiCustomersResponse(response)));
  }

  getCustomerById(id: string): Observable<PosCustomer | null> {
    return this.posApi.getCustomerById(id).pipe(
      map((response: any) =>
        response ? this.mapApiCustomerToPosCustomer(response) : null,
      ),
      catchError(() => of(null)),
    );
  }

  updateCustomer(
    id: string,
    updates: Partial<CreatePosCustomerRequest>,
  ): Observable<PosCustomer> {
    return this.posApi
      .updateCustomer(id, updates)
      .pipe(map((response: any) => this.mapApiCustomerToPosCustomer(response)));
  }

  // Product Integration
  searchProducts(params: any): Observable<any> {
    return this.posApi.searchProducts(params);
  }

  getProductById(id: string): Observable<Product | null> {
    return this.posApi.getProductById(id).pipe(
      map((response: any) =>
        response ? this.mapApiProductToProduct(response) : null,
      ),
      catchError(() => of(null)),
    );
  }

  getProductByBarcode(barcode: string): Observable<Product | null> {
    return this.posApi.getProductByBarcode(barcode).pipe(
      map((response: any) =>
        response ? this.mapApiProductToProduct(response) : null,
      ),
      catchError(() => of(null)),
    );
  }

  getProductBySku(sku: string): Observable<Product | null> {
    return this.posApi.getProductBySku(sku).pipe(
      map((response: any) =>
        response ? this.mapApiProductToProduct(response) : null,
      ),
      catchError(() => of(null)),
    );
  }

  updateStock(productId: string, quantity: number): Observable<Product | null> {
    return this.posApi
      .updateStock(productId, { quantity })
      .pipe(
        map((response: any) =>
          response ? this.mapApiProductToProduct(response) : null,
        ),
      );
  }

  // Order Integration
  createOrder(request: CreatePosOrderRequest): Observable<PosOrder> {
    return this.posApi
      .createOrder(request)
      .pipe(map((response: any) => this.mapApiOrderToPosOrder(response)));
  }

  createDraftOrder(request: CreatePosOrderRequest): Observable<PosOrder> {
    return this.posApi
      .createDraftOrder(request)
      .pipe(map((response: any) => this.mapApiOrderToPosOrder(response)));
  }

  updateOrder(
    id: string,
    request: UpdatePosOrderRequest,
  ): Observable<PosOrder> {
    return this.posApi
      .updateOrder(id, request)
      .pipe(map((response: any) => this.mapApiOrderToPosOrder(response)));
  }

  getOrderById(id: string): Observable<PosOrder | null> {
    return this.posApi.getOrderById(id).pipe(
      map((response: any) =>
        response ? this.mapApiOrderToPosOrder(response) : null,
      ),
      catchError(() => of(null)),
    );
  }

  getOrderByNumber(orderNumber: string): Observable<PosOrder | null> {
    return this.posApi.getOrderByNumber(orderNumber).pipe(
      map((response: any) =>
        response ? this.mapApiOrderToPosOrder(response) : null,
      ),
      catchError(() => of(null)),
    );
  }

  searchOrders(
    request: OrderSearchRequest,
  ): Observable<PaginatedOrdersResponse> {
    return this.posApi
      .searchOrders(this.mapOrderSearchRequestToApiParams(request))
      .pipe(map((response: any) => this.mapApiOrdersResponse(response)));
  }

  cancelOrder(id: string, reason?: string): Observable<PosOrder> {
    return this.posApi
      .cancelOrder(id, reason)
      .pipe(map((response: any) => this.mapApiOrderToPosOrder(response)));
  }

  refundOrder(id: string, reason?: string): Observable<PosOrder> {
    return this.posApi
      .refundOrder(id, reason)
      .pipe(map((response: any) => this.mapApiOrderToPosOrder(response)));
  }

  getOrderStats(params?: any): Observable<OrderStats> {
    return this.posApi
      .getOrderStats(params)
      .pipe(map((response: any) => this.mapApiOrderStats(response)));
  }

  // Payment Integration
  processPayment(
    request: ProcessPaymentRequest,
  ): Observable<ProcessPaymentResponse> {
    const paymentRequest = this.mapProcessPaymentToPaymentRequest(request);

    return this.posApi
      .processPayment(paymentRequest)
      .pipe(map((response: any) => this.mapApiPaymentResponse(response)));
  }

  getPaymentMethods(): Observable<PaymentMethod[]> {
    return this.posApi
      .getPaymentMethods()
      .pipe(
        map((response: any) =>
          response.map((method: any) => this.mapApiPaymentMethod(method)),
        ),
      );
  }

  refundPayment(paymentId: string, reason?: string): Observable<any> {
    return this.posApi.refundPayment(paymentId, reason);
  }

  getTransactionHistory(params?: any): Observable<Transaction[]> {
    return this.posApi
      .getTransactionHistory(params)
      .pipe(
        map((response: any) =>
          response.map((tx: any) => this.mapApiTransaction(tx)),
        ),
      );
  }

  // Mapping methods
  private mapApiCustomerToPosCustomer(apiCustomer: any): PosCustomer {
    return {
      id: apiCustomer.id,
      email: apiCustomer.email,
      name: apiCustomer.name,
      phone: apiCustomer.phone,
      documentType: apiCustomer.documentType,
      documentNumber: apiCustomer.documentNumber,
      address: apiCustomer.address,
      createdAt: new Date(apiCustomer.createdAt),
      updatedAt: new Date(apiCustomer.updatedAt),
    };
  }

  private mapApiCustomersResponse(response: any): PaginatedCustomersResponse {
    return {
      customers: response.customers.map((c: any) =>
        this.mapApiCustomerToPosCustomer(c),
      ),
      total: response.total,
      limit: response.limit,
      offset: response.offset,
      hasMore: response.hasMore,
    };
  }

  private mapApiProductToProduct(apiProduct: any): Product {
    return {
      id: apiProduct.id,
      name: apiProduct.name,
      sku: apiProduct.sku,
      price: apiProduct.price,
      cost: apiProduct.cost,
      category: apiProduct.category,
      brand: apiProduct.brand,
      stock: apiProduct.stock,
      minStock: apiProduct.minStock,
      image: apiProduct.image,
      description: apiProduct.description,
      barcode: apiProduct.barcode,
      tags: apiProduct.tags,
      isActive: apiProduct.isActive,
      createdAt: new Date(apiProduct.createdAt),
      updatedAt: new Date(apiProduct.updatedAt),
    };
  }

  private mapApiOrderToPosOrder(apiOrder: any): PosOrder {
    return {
      id: apiOrder.id,
      orderNumber: apiOrder.orderNumber,
      customer: apiOrder.customer
        ? this.mapApiCustomerToPosCustomer(apiOrder.customer)
        : null,
      items: apiOrder.items.map((item: any) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        productSku: item.productSku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        cost: item.cost,
        notes: item.notes,
        discounts:
          item.discounts?.map((d: any) => ({
            id: d.id,
            type: d.type,
            value: d.value,
            description: d.description,
            amount: d.amount,
          })) || [],
      })),
      summary: {
        subtotal: apiOrder.summary.subtotal,
        discountAmount: apiOrder.summary.discountAmount,
        taxAmount: apiOrder.summary.taxAmount,
        total: apiOrder.summary.total,
        itemCount: apiOrder.summary.itemCount,
        totalItems: apiOrder.summary.totalItems,
        profit: apiOrder.summary.profit,
      },
      status: apiOrder.status,
      paymentStatus: apiOrder.paymentStatus,
      payments: apiOrder.payments.map((payment: any) => ({
        id: payment.id,
        paymentMethod: this.mapApiPaymentMethod(payment.paymentMethod),
        amount: payment.amount,
        status: payment.status,
        transactionId: payment.transactionId,
        reference: payment.reference,
        details: payment.details,
        createdAt: new Date(payment.createdAt),
        processedAt: payment.processedAt
          ? new Date(payment.processedAt)
          : undefined,
      })),
      notes: apiOrder.notes,
      createdAt: new Date(apiOrder.createdAt),
      updatedAt: new Date(apiOrder.updatedAt),
      completedAt: apiOrder.completedAt
        ? new Date(apiOrder.completedAt)
        : undefined,
      createdBy: apiOrder.createdBy,
      storeId: apiOrder.storeId,
      organizationId: apiOrder.organizationId,
    };
  }

  private mapApiOrdersResponse(response: any): PaginatedOrdersResponse {
    return {
      orders: response.orders.map((o: any) => this.mapApiOrderToPosOrder(o)),
      total: response.total,
      limit: response.limit,
      offset: response.offset,
      hasMore: response.hasMore,
    };
  }

  private mapApiOrderStats(apiStats: any): OrderStats {
    return {
      totalOrders: apiStats.totalOrders,
      totalRevenue: apiStats.totalRevenue,
      averageOrderValue: apiStats.averageOrderValue,
      ordersByStatus: apiStats.ordersByStatus,
      paymentMethods: apiStats.paymentMethods,
      topProducts: apiStats.topProducts,
    };
  }

  private mapApiPaymentMethod(apiMethod: any): PaymentMethod {
    return {
      id: apiMethod.id,
      name: apiMethod.name,
      type: apiMethod.type,
      icon: apiMethod.icon,
      enabled: apiMethod.enabled,
      requiresReference: apiMethod.requiresReference,
      referenceLabel: apiMethod.referenceLabel,
    };
  }

  private mapApiTransaction(apiTx: any): Transaction {
    return {
      id: apiTx.id,
      orderId: apiTx.orderId,
      amount: apiTx.amount,
      paymentMethod: this.mapApiPaymentMethod(apiTx.paymentMethod),
      status: apiTx.status,
      createdAt: new Date(apiTx.createdAt),
      reference: apiTx.reference,
      details: apiTx.details,
    };
  }

  private mapProcessPaymentToPaymentRequest(
    request: ProcessPaymentRequest,
  ): PaymentRequest {
    return {
      orderId: request.orderId,
      amount: request.amount,
      paymentMethod: request.paymentMethod,
      reference: request.reference,
      cashReceived: request.cashReceived,
    };
  }

  private mapApiPaymentResponse(response: any): ProcessPaymentResponse {
    return {
      success: response.success,
      payment: response.payment
        ? this.mapApiOrderPayment(response.payment)
        : undefined,
      transaction: response.transaction
        ? this.mapApiTransaction(response.transaction)
        : undefined,
      change: response.change,
      message: response.message,
    };
  }

  private mapApiOrderPayment(apiPayment: any): any {
    return {
      id: apiPayment.id,
      paymentMethod: this.mapApiPaymentMethod(apiPayment.paymentMethod),
      amount: apiPayment.amount,
      status: apiPayment.status,
      transactionId: apiPayment.transactionId,
      reference: apiPayment.reference,
      details: apiPayment.details,
      createdAt: new Date(apiPayment.createdAt),
      processedAt: apiPayment.processedAt
        ? new Date(apiPayment.processedAt)
        : undefined,
    };
  }

  private mapOrderSearchRequestToApiParams(request: OrderSearchRequest): any {
    return {
      query: request.query || '',
      status: request.status || '',
      paymentStatus: request.paymentStatus || '',
      customerId: request.customerId || '',
      dateFrom: request.dateFrom?.toISOString() || '',
      dateTo: request.dateTo?.toISOString() || '',
      limit: request.limit?.toString() || '20',
      offset: request.offset?.toString() || '0',
      sortBy: request.sortBy || 'createdAt',
      sortOrder: request.sortOrder || 'desc',
    };
  }

  private mapApiErrorsToValidationErrors(
    error: any,
  ): CustomerValidationError[] {
    // This would depend on how the API returns validation errors
    if (error?.error?.errors) {
      return error.error.errors.map((err: any) => ({
        field: err.field,
        message: err.message,
      }));
    }
    return [];
  }
}
