import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Import shared components
import { StatsComponent } from '../../../../../shared/components/index';

import { PosDashboardService } from '../services/pos-dashboard.service';
import { DashboardData, DashboardFilters } from '../models/dashboard.model';

@Component({
  selector: 'app-pos-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, StatsComponent],
  template: `
    <div class="pos-dashboard-container">
      <div class="dashboard-header">
        <h2>Dashboard POS</h2>
        <div class="header-controls">
          <select
            class="date-range-select"
            [(ngModel)]="filters.dateRange"
            (change)="onFiltersChange()"
          >
            <option value="today">Hoy</option>
            <option value="week">Esta Semana</option>
            <option value="month">Este Mes</option>
            <option value="year">Este Año</option>
          </select>
          <button
            class="refresh-btn"
            (click)="refreshData()"
            [disabled]="loading"
            type="button"
          >
            <i class="fas fa-sync-alt" [class.spinning]="loading"></i>
            Actualizar
          </button>
        </div>
      </div>

      <div class="stats-overview" *ngIf="dashboardData">
        <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6">
          <!-- Ventas -->
          <app-stats
            title="Ventas"
            [value]="'$' + formatNumber(dashboardData.todayStats.totalSales)"
            smallText="+12.5% vs ayer"
            iconName="dollar-sign"
            iconBgColor="bg-primary/10"
            iconColor="text-primary"
          ></app-stats>

          <!-- Órdenes -->
          <app-stats
            title="Órdenes"
            [value]="dashboardData.todayStats.totalOrders"
            smallText="+8.2% vs ayer"
            iconName="shopping-cart"
            iconBgColor="bg-pink-100"
            iconColor="text-pink-600"
          ></app-stats>

          <!-- Clientes -->
          <app-stats
            title="Clientes"
            [value]="dashboardData.todayStats.totalCustomers"
            smallText="+15.3% vs ayer"
            iconName="users"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <!-- Promedio -->
          <app-stats
            title="Promedio"
            [value]="'$' + formatNumber(dashboardData.todayStats.averageOrderValue)"
            smallText="-2.1% vs ayer"
            iconName="trending-up"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>
        </div>
      </div>

      <div class="dashboard-content" *ngIf="dashboardData">
        <div class="content-row">
          <div class="chart-container">
            <div class="chart-header">
              <h3>Ventas Diarias</h3>
              <div class="chart-actions">
                <button
                  class="export-btn"
                  (click)="exportData('csv')"
                  type="button"
                >
                  <i class="fas fa-download"></i>
                  CSV
                </button>
                <button
                  class="export-btn"
                  (click)="exportData('excel')"
                  type="button"
                >
                  <i class="fas fa-file-excel"></i>
                  Excel
                </button>
              </div>
            </div>
            <div class="chart-placeholder">
              <canvas id="salesChart"></canvas>
              <p class="chart-text">Gráfico de ventas diarias</p>
            </div>
          </div>

          <div class="top-products-container">
            <div class="section-header">
              <h3>Productos Más Vendidos</h3>
            </div>
            <div class="products-list">
              <div
                class="product-item"
                *ngFor="
                  let product of dashboardData.topProducts;
                  trackBy: trackById
                "
              >
                <div class="product-info">
                  <h4>{{ product.name }}</h4>
                  <p class="product-sku">{{ product.sku }}</p>
                </div>
                <div class="product-stats">
                  <p class="product-quantity">
                    {{ product.quantity }} unidades
                  </p>
                  <p class="product-revenue">
                    \${{ product.revenue | number: '1.0-0' }}
                  </p>
                  <div class="product-bar">
                    <div
                      class="bar-fill"
                      [style.width.%]="product.percentage"
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="content-row">
          <div class="payment-methods-container">
            <div class="section-header">
              <h3>Métodos de Pago</h3>
            </div>
            <div class="payment-methods">
              <div
                class="payment-item"
                *ngFor="
                  let method of dashboardData.paymentMethods;
                  trackBy: trackByMethod
                "
              >
                <div class="payment-info">
                  <span class="payment-name">{{ method.method }}</span>
                  <span class="payment-count"
                    >{{ method.count }} transacciones</span
                  >
                </div>
                <div class="payment-stats">
                  <span class="payment-amount"
                    >\${{ method.amount | number: '1.0-0' }}</span
                  >
                  <span class="payment-percentage"
                    >{{ method.percentage | number: '1.1' }}%</span
                  >
                </div>
              </div>
            </div>
          </div>

          <div class="categories-container">
            <div class="section-header">
              <h3>Ventas por Categoría</h3>
            </div>
            <div class="categories-list">
              <div
                class="category-item"
                *ngFor="
                  let category of dashboardData.categoryStats;
                  trackBy: trackByCategory
                "
              >
                <div class="category-info">
                  <span class="category-name">{{ category.category }}</span>
                  <span class="category-quantity"
                    >{{ category.quantity }} productos</span
                  >
                </div>
                <div class="category-stats">
                  <span class="category-sales"
                    >\${{ category.sales | number: '1.0-0' }}</span
                  >
                  <span class="category-percentage"
                    >{{ category.percentage | number: '1.1' }}%</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="loading-overlay" *ngIf="loading">
        <div class="loading-spinner">
          <i class="fas fa-spinner fa-spin"></i>
          <p>Cargando datos...</p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .pos-dashboard-container {
        padding: 24px;
        background: #f8fafc;
        min-height: 100vh;
      }

      .dashboard-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 32px;
      }

      .dashboard-header h2 {
        margin: 0;
        font-size: 28px;
        font-weight: 700;
        color: #1e293b;
      }

      .header-controls {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      .date-range-select {
        padding: 10px 16px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 14px;
        background: white;
        cursor: pointer;
      }

      .date-range-select:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .refresh-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .refresh-btn:hover:not(:disabled) {
        background: #2563eb;
      }

      .refresh-btn:disabled {
        background: #9ca3af;
        cursor: not-allowed;
      }

      .refresh-btn .spinning {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .stats-overview {
        margin-bottom: 32px;
      }

      .dashboard-content {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .content-row {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 24px;
      }

      .chart-container,
      .top-products-container,
      .payment-methods-container,
      .categories-container {
        background: white;
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .chart-header,
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }

      .chart-header h3,
      .section-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #1e293b;
      }

      .chart-actions {
        display: flex;
        gap: 8px;
      }

      .export-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        font-size: 12px;
        color: #475569;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .export-btn:hover {
        background: #e2e8f0;
      }

      .chart-placeholder {
        height: 300px;
        background: #f8fafc;
        border: 2px dashed #d1d5db;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6b7280;
      }

      .chart-text {
        margin: 0;
        font-size: 14px;
      }

      .products-list,
      .payment-methods,
      .categories-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .product-item,
      .payment-item,
      .category-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 0;
        border-bottom: 1px solid #f1f5f9;
      }

      .product-item:last-child,
      .payment-item:last-child,
      .category-item:last-child {
        border-bottom: none;
      }

      .product-info h4 {
        margin: 0 0 4px;
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
      }

      .product-sku {
        margin: 0;
        font-size: 12px;
        color: #64748b;
      }

      .product-stats {
        text-align: right;
        min-width: 120px;
      }

      .product-quantity,
      .product-revenue {
        margin: 0 0 4px;
        font-size: 12px;
        color: #64748b;
      }

      .product-revenue {
        font-weight: 600;
        color: #1e293b;
      }

      .product-bar {
        width: 100%;
        height: 4px;
        background: #f1f5f9;
        border-radius: 2px;
        overflow: hidden;
      }

      .bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%);
        transition: width 0.3s ease;
      }

      .payment-info,
      .category-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .payment-name,
      .category-name {
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
      }

      .payment-count,
      .category-quantity {
        font-size: 12px;
        color: #64748b;
      }

      .payment-stats,
      .category-stats {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
      }

      .payment-amount,
      .category-sales {
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
      }

      .payment-percentage,
      .category-percentage {
        font-size: 12px;
        color: #64748b;
      }

      .loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .loading-spinner {
        background: white;
        border-radius: 12px;
        padding: 32px;
        text-align: center;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      }

      .loading-spinner i {
        font-size: 32px;
        color: #3b82f6;
        margin-bottom: 16px;
      }

      .loading-spinner p {
        margin: 0;
        font-size: 16px;
        color: #64748b;
      }

      @media (max-width: 1024px) {
        .content-row {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 768px) {
        .dashboard-header {
          flex-direction: column;
          align-items: stretch;
          gap: 16px;
        }

        .header-controls {
          justify-content: center;
        }
      }
    `,
  ],
})
export class PosDashboardComponent implements OnInit {
  @Output() dataExported = new EventEmitter<{ format: string; data: Blob }>();

  dashboardData: DashboardData | null = null;
  loading: boolean = false;
  filters: DashboardFilters = {
    dateRange: 'today',
  };

  constructor(private dashboardService: PosDashboardService) {}

  ngOnInit(): void {
    this.loadDashboardData();
  }

  onFiltersChange(): void {
    this.loadDashboardData();
  }

  refreshData(): void {
    this.loadDashboardData();
  }

  private loadDashboardData(): void {
    this.loading = true;

    this.dashboardService.getDashboardData(this.filters).subscribe({
      next: (data) => {
        this.dashboardData = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error cargando datos del dashboard:', error);
        this.loading = false;
      },
    });
  }

  exportData(format: 'csv' | 'excel' | 'pdf'): void {
    if (!this.dashboardData) return;

    this.dashboardService.exportDashboardData(this.filters, format).subscribe({
      next: (blob) => {
        this.dataExported.emit({ format, data: blob });
        this.downloadFile(
          blob,
          `dashboard-${this.filters.dateRange}.${format}`,
        );
      },
      error: (error) => {
        console.error('Error exportando datos:', error);
      },
    });
  }

  private downloadFile(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  trackById(_index: number, item: any): string {
    return item.id;
  }

  trackByMethod(_index: number, item: any): string {
    return item.method;
  }

  trackByCategory(_index: number, item: any): string {
    return item.category;
  }

  // Formatear número para visualización
  formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toFixed(0);
  }
}
