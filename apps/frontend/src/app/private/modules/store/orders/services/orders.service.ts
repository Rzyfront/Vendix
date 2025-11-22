import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  SalesOrder,
  PurchaseOrder,
  StockTransfer,
  CreateSalesOrderRequest,
  CreatePurchaseOrderRequest,
  CreateStockTransferRequest,
} from '../interfaces/order.interface';

@Injectable({
  providedIn: 'root',
})
export class OrdersService {
  private baseUrl = '/api'; // Ajustar según configuración

  constructor(private http: HttpClient) {}

  // SALES ORDERS
  getSalesOrders(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Observable<{ data: SalesOrder[]; meta: any }> {
    let httpParams = new HttpParams();
    if (params?.page)
      httpParams = httpParams.set('page', params.page.toString());
    if (params?.limit)
      httpParams = httpParams.set('limit', params.limit.toString());
    if (params?.status) httpParams = httpParams.set('status', params.status);

    return this.http.get<{ data: SalesOrder[]; meta: any }>(
      `${this.baseUrl}/sales-orders`,
      { params: httpParams },
    );
  }

  getSalesOrder(id: number): Observable<SalesOrder> {
    return this.http.get<SalesOrder>(`${this.baseUrl}/sales-orders/${id}`);
  }

  createSalesOrder(order: CreateSalesOrderRequest): Observable<SalesOrder> {
    return this.http.post<SalesOrder>(
      `${this.baseUrl}/orders/sales-orders`,
      order,
    );
  }

  updateSalesOrder(
    id: number,
    order: Partial<SalesOrder>,
  ): Observable<SalesOrder> {
    return this.http.put<SalesOrder>(
      `${this.baseUrl}/sales-orders/${id}`,
      order,
    );
  }

  deleteSalesOrder(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/sales-orders/${id}`);
  }

  // PURCHASE ORDERS
  getPurchaseOrders(params?: {
    page?: number;
    limit?: number;
  }): Observable<{ data: PurchaseOrder[]; meta: any }> {
    let httpParams = new HttpParams();
    if (params?.page)
      httpParams = httpParams.set('page', params.page.toString());
    if (params?.limit)
      httpParams = httpParams.set('limit', params.limit.toString());

    return this.http.get<{ data: PurchaseOrder[]; meta: any }>(
      `${this.baseUrl}/purchase-orders`,
      { params: httpParams },
    );
  }

  getPurchaseOrder(id: number): Observable<PurchaseOrder> {
    return this.http.get<PurchaseOrder>(
      `${this.baseUrl}/purchase-orders/${id}`,
    );
  }

  createPurchaseOrder(
    order: CreatePurchaseOrderRequest,
  ): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(
      `${this.baseUrl}/orders/purchase-orders`,
      order,
    );
  }

  updatePurchaseOrder(
    id: number,
    order: Partial<PurchaseOrder>,
  ): Observable<PurchaseOrder> {
    return this.http.put<PurchaseOrder>(
      `${this.baseUrl}/purchase-orders/${id}`,
      order,
    );
  }

  deletePurchaseOrder(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/purchase-orders/${id}`);
  }

  // STOCK TRANSFERS
  getStockTransfers(params?: {
    page?: number;
    limit?: number;
  }): Observable<{ data: StockTransfer[]; meta: any }> {
    let httpParams = new HttpParams();
    if (params?.page)
      httpParams = httpParams.set('page', params.page.toString());
    if (params?.limit)
      httpParams = httpParams.set('limit', params.limit.toString());

    return this.http.get<{ data: StockTransfer[]; meta: any }>(
      `${this.baseUrl}/stock-transfers`,
      { params: httpParams },
    );
  }

  getStockTransfer(id: number): Observable<StockTransfer> {
    return this.http.get<StockTransfer>(
      `${this.baseUrl}/stock-transfers/${id}`,
    );
  }

  createStockTransfer(
    transfer: CreateStockTransferRequest,
  ): Observable<StockTransfer> {
    return this.http.post<StockTransfer>(
      `${this.baseUrl}/stock-transfers`,
      transfer,
    );
  }

  updateStockTransfer(
    id: number,
    transfer: Partial<StockTransfer>,
  ): Observable<StockTransfer> {
    return this.http.put<StockTransfer>(
      `${this.baseUrl}/stock-transfers/${id}`,
      transfer,
    );
  }

  deleteStockTransfer(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/stock-transfers/${id}`);
  }
}
