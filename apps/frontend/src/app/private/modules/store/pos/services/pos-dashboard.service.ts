import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import {
  DashboardData,
  DashboardFilters,
  SalesStats,
  DailySales,
  TopProduct,
  PaymentMethodStats,
  HourlySales,
  CategoryStats,
} from '../models/dashboard.model';

@Injectable({
  providedIn: 'root',
})
export class PosDashboardService {
  constructor() {}

  getDashboardData(filters: DashboardFilters): Observable<DashboardData> {
    return of(filters).pipe(
      delay(1500),
      map(() => this.generateMockDashboardData(filters)),
    );
  }

  private generateMockDashboardData(filters: DashboardFilters): DashboardData {
    const todayStats = this.generateSalesStats(10000, 50, 30);
    const weeklyStats = this.generateSalesStats(70000, 350, 200);
    const monthlyStats = this.generateSalesStats(300000, 1500, 800);

    return {
      todayStats,
      weeklyStats,
      monthlyStats,
      dailySales: this.generateDailySales(filters.dateRange),
      topProducts: this.generateTopProducts(),
      paymentMethods: this.generatePaymentMethodStats(),
      hourlySales: this.generateHourlySales(),
      categoryStats: this.generateCategoryStats(),
      lastUpdated: new Date(),
    };
  }

  private generateSalesStats(
    totalSales: number,
    totalOrders: number,
    totalCustomers: number,
  ): SalesStats {
    const newCustomers = Math.floor(totalCustomers * 0.3);
    const returningCustomers = totalCustomers - newCustomers;
    const averageOrderValue = totalSales / totalOrders;

    return {
      totalSales,
      totalOrders,
      averageOrderValue,
      totalCustomers,
      newCustomers,
      returningCustomers,
    };
  }

  private generateDailySales(dateRange: string): DailySales[] {
    const days =
      dateRange === 'today'
        ? 1
        : dateRange === 'week'
          ? 7
          : dateRange === 'month'
            ? 30
            : 365;
    const sales: DailySales[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);

      sales.push({
        date: date.toISOString().split('T')[0],
        sales: Math.floor(Math.random() * 5000) + 2000,
        orders: Math.floor(Math.random() * 30) + 10,
        customers: Math.floor(Math.random() * 25) + 8,
      });
    }

    return sales;
  }

  private generateTopProducts(): TopProduct[] {
    const products = [
      { name: 'Laptop Dell Inspiron 15', sku: 'LAP-DEL-001' },
      { name: 'Mouse Logitech MX Master 3', sku: 'MOU-LOG-002' },
      { name: 'Teclado Mecánico RGB', sku: 'KEY-MEC-003' },
      { name: 'Monitor LG 27" 4K', sku: 'MON-LG-004' },
      { name: 'USB-C Hub 7-en-1', sku: 'HUB-USB-006' },
    ];

    const totalRevenue = 15000;
    let accumulatedRevenue = 0;

    return products
      .map((product, index) => {
        const quantity = Math.floor(Math.random() * 20) + 5;
        const price = Math.floor(Math.random() * 500) + 100;
        const revenue = quantity * price;
        accumulatedRevenue += revenue;

        return {
          id: (index + 1).toString(),
          name: product.name,
          sku: product.sku,
          quantity,
          revenue,
          percentage: (revenue / totalRevenue) * 100,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }

  private generatePaymentMethodStats(): PaymentMethodStats[] {
    const methods = [
      { name: 'Efectivo', weight: 0.4 },
      { name: 'Tarjeta de Crédito', weight: 0.35 },
      { name: 'Tarjeta de Débito', weight: 0.15 },
      { name: 'Transferencia', weight: 0.07 },
      { name: 'Billetera Digital', weight: 0.03 },
    ];

    const totalAmount = 10000;

    return methods.map((method) => {
      const amount = totalAmount * method.weight;
      const count = Math.floor(amount / 150);

      return {
        method: method.name,
        count,
        amount,
        percentage: method.weight * 100,
      };
    });
  }

  private generateHourlySales(): HourlySales[] {
    const sales: HourlySales[] = [];

    for (let hour = 0; hour < 24; hour++) {
      let multiplier = 0;

      if (hour >= 9 && hour <= 11) multiplier = 0.8;
      else if (hour >= 12 && hour <= 14) multiplier = 1.2;
      else if (hour >= 15 && hour <= 17) multiplier = 1.0;
      else if (hour >= 18 && hour <= 20) multiplier = 1.5;
      else multiplier = 0.2;

      const baseSales = 500;
      const salesAmount = baseSales * multiplier * (0.8 + Math.random() * 0.4);
      const orders = Math.floor(salesAmount / 200);

      sales.push({
        hour,
        sales: Math.floor(salesAmount),
        orders,
      });
    }

    return sales;
  }

  private generateCategoryStats(): CategoryStats[] {
    const categories = [
      { name: 'Electrónica', weight: 0.45 },
      { name: 'Accesorios', weight: 0.3 },
      { name: 'Audio', weight: 0.15 },
      { name: 'Muebles', weight: 0.1 },
    ];

    const totalSales = 10000;

    return categories.map((category) => {
      const sales = totalSales * category.weight;
      const quantity = Math.floor(sales / 150);

      return {
        category: category.name,
        sales: Math.floor(sales),
        quantity,
        percentage: category.weight * 100,
      };
    });
  }

  getRealTimeStats(): Observable<SalesStats> {
    return of({}).pipe(
      delay(500),
      map(() =>
        this.generateSalesStats(
          Math.floor(Math.random() * 2000) + 8000,
          Math.floor(Math.random() * 20) + 40,
          Math.floor(Math.random() * 15) + 25,
        ),
      ),
    );
  }

  exportDashboardData(
    filters: DashboardFilters,
    format: 'csv' | 'excel' | 'pdf',
  ): Observable<Blob> {
    return of({}).pipe(
      delay(2000),
      map(() => {
        const data = this.generateMockDashboardData(filters);
        const content = this.generateExportContent(data, format);

        return new Blob([content], {
          type: this.getContentType(format),
        });
      }),
    );
  }

  private generateExportContent(data: DashboardData, format: string): string {
    switch (format) {
      case 'csv':
        return this.generateCSV(data);
      case 'excel':
        return this.generateExcel(data);
      case 'pdf':
        return this.generatePDF(data);
      default:
        return '';
    }
  }

  private generateCSV(data: DashboardData): string {
    const headers = ['Fecha', 'Ventas', 'Órdenes', 'Clientes'];
    const rows = data.dailySales.map((day) =>
      [day.date, day.sales, day.orders, day.customers].join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }

  private generateExcel(data: DashboardData): string {
    return JSON.stringify(data, null, 2);
  }

  private generatePDF(data: DashboardData): string {
    return `<html><body><h1>Dashboard POS</h1><pre>${JSON.stringify(data, null, 2)}</pre></body></html>`;
  }

  private getContentType(format: string): string {
    switch (format) {
      case 'csv':
        return 'text/csv';
      case 'excel':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case 'pdf':
        return 'application/pdf';
      default:
        return 'text/plain';
    }
  }

  comparePeriods(
    currentPeriod: DashboardFilters,
    previousPeriod: DashboardFilters,
  ): Observable<any> {
    return of({}).pipe(
      delay(1000),
      map(() => {
        const current = this.generateMockDashboardData(currentPeriod);
        const previous = this.generateMockDashboardData(previousPeriod);

        return {
          sales: {
            current: current.todayStats.totalSales,
            previous: previous.todayStats.totalSales,
            change:
              ((current.todayStats.totalSales -
                previous.todayStats.totalSales) /
                previous.todayStats.totalSales) *
              100,
          },
          orders: {
            current: current.todayStats.totalOrders,
            previous: previous.todayStats.totalOrders,
            change:
              ((current.todayStats.totalOrders -
                previous.todayStats.totalOrders) /
                previous.todayStats.totalOrders) *
              100,
          },
          customers: {
            current: current.todayStats.totalCustomers,
            previous: previous.todayStats.totalCustomers,
            change:
              ((current.todayStats.totalCustomers -
                previous.todayStats.totalCustomers) /
                previous.todayStats.totalCustomers) *
              100,
          },
        };
      }),
    );
  }

  getCashierStats(
    cashierId: string,
    filters: DashboardFilters,
  ): Observable<SalesStats> {
    return of({ cashierId, filters }).pipe(
      delay(800),
      map(() => {
        const multiplier = Math.random() * 0.5 + 0.75;
        const baseStats = this.generateSalesStats(10000, 50, 30);

        return {
          totalSales: baseStats.totalSales * multiplier,
          totalOrders: Math.floor(baseStats.totalOrders * multiplier),
          averageOrderValue: baseStats.averageOrderValue,
          totalCustomers: Math.floor(baseStats.totalCustomers * multiplier),
          newCustomers: Math.floor(baseStats.newCustomers * multiplier),
          returningCustomers: Math.floor(
            baseStats.returningCustomers * multiplier,
          ),
        };
      }),
    );
  }

  getProductPerformance(
    productId: string,
    filters: DashboardFilters,
  ): Observable<any> {
    return of({ productId, filters }).pipe(
      delay(600),
      map(() => ({
        productId,
        totalSold: Math.floor(Math.random() * 100) + 20,
        revenue: Math.floor(Math.random() * 5000) + 1000,
        averagePrice: Math.floor(Math.random() * 200) + 50,
        stockLevel: Math.floor(Math.random() * 50) + 10,
        reorderPoint: 15,
        trend: Math.random() > 0.5 ? 'up' : 'down',
        trendPercentage: Math.floor(Math.random() * 30) + 5,
      })),
    );
  }
}
