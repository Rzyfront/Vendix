import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { AnalyticsCategory } from './interfaces/analytics.interface';

@Component({
  selector: 'vendix-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <!-- Header -->
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-bold text-text-primary">Centro de Analíticas</h1>
        <p class="text-text-secondary">
          Genera y exporta análisis detallados de tu negocio
        </p>
      </div>

      <!-- Analytics Categories Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        @for (category of analyticsCategories; track category.id) {
          <a
            [routerLink]="category.route"
            class="group bg-surface border border-border rounded-xl p-5 hover:border-primary/50 hover:shadow-md transition-all duration-200 cursor-pointer"
          >
            <!-- Icon & Title -->
            <div class="flex items-start gap-4">
              <div
                class="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center"
                [class]="category.color"
              >
                <app-icon [name]="category.icon" [size]="24" class="text-white"></app-icon>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-text-primary group-hover:text-primary transition-colors">
                  {{ category.label }}
                </h3>
                <p class="text-sm text-text-secondary mt-1 line-clamp-2">
                  {{ category.description }}
                </p>
              </div>
            </div>

            <!-- Analytics List -->
            <div class="mt-4 pt-4 border-t border-border">
              <p class="text-xs text-text-tertiary mb-2">Análisis disponibles:</p>
              <ul class="space-y-1">
                @for (item of category.items.slice(0, 3); track item.id) {
                  <li class="flex items-center gap-2 text-sm text-text-secondary">
                    <app-icon name="circle" [size]="6" class="text-text-tertiary"></app-icon>
                    {{ item.label }}
                  </li>
                }
                @if (category.items.length > 3) {
                  <li class="text-sm text-primary">
                    +{{ category.items.length - 3 }} más
                  </li>
                }
              </ul>
            </div>
          </a>
        }
      </div>

      <!-- Quick Stats Section -->
      <div class="bg-surface border border-border rounded-xl p-6">
        <h2 class="text-lg font-semibold text-text-primary mb-4">Acceso Rápido</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          @for (quickLink of quickLinks; track quickLink.route) {
            <a
              [routerLink]="quickLink.route"
              class="flex items-center gap-3 p-3 rounded-lg hover:bg-background transition-colors"
            >
              <app-icon [name]="quickLink.icon" [size]="20" class="text-text-secondary"></app-icon>
              <span class="text-sm text-text-primary">{{ quickLink.label }}</span>
            </a>
          }
        </div>
      </div>
    </div>
  `,
})
export class AnalyticsComponent {
  analyticsCategories: AnalyticsCategory[] = [
    {
      id: 'sales',
      label: 'Ventas',
      description: 'Análisis de ingresos, órdenes y tendencias de ventas',
      icon: 'trending-up',
      route: './sales',
      color: 'bg-green-500',
      items: [
        { id: 'summary', label: 'Resumen de Ventas', description: '', route: './sales/summary' },
        { id: 'by-product', label: 'Ventas por Producto', description: '', route: './sales/by-product' },
        { id: 'by-category', label: 'Ventas por Categoría', description: '', route: './sales/by-category' },
        { id: 'trends', label: 'Tendencias', description: '', route: './sales/trends' },
        { id: 'by-customer', label: 'Ventas por Cliente', description: '', route: './sales/by-customer' },
        { id: 'by-payment', label: 'Ventas por Método de Pago', description: '', route: './sales/by-payment' },
      ],
    },
    {
      id: 'inventory',
      label: 'Inventario',
      description: 'Stock, movimientos, valoración y alertas',
      icon: 'package',
      route: './inventory',
      color: 'bg-blue-500',
      items: [
        { id: 'stock-levels', label: 'Niveles de Stock', description: '', route: './inventory/stock-levels' },
        { id: 'low-stock', label: 'Alertas de Stock Bajo', description: '', route: './inventory/low-stock' },
        { id: 'movements', label: 'Movimientos', description: '', route: './inventory/movements' },
        { id: 'valuation', label: 'Valoración', description: '', route: './inventory/valuation' },
      ],
    },
    {
      id: 'products',
      label: 'Productos',
      description: 'Rendimiento, rentabilidad y análisis de productos',
      icon: 'box',
      route: './products',
      color: 'bg-purple-500',
      items: [
        { id: 'performance', label: 'Rendimiento', description: '', route: './products/performance' },
        { id: 'top-sellers', label: 'Top Sellers', description: '', route: './products/top-sellers' },
        { id: 'profitability', label: 'Rentabilidad', description: '', route: './products/profitability' },
      ],
    },
    {
      id: 'purchases',
      label: 'Compras',
      description: 'Órdenes de compra, proveedores y costos',
      icon: 'shopping-cart',
      route: './purchases',
      color: 'bg-orange-500',
      items: [
        { id: 'summary', label: 'Resumen de Compras', description: '', route: './purchases/summary' },
        { id: 'by-supplier', label: 'Compras por Proveedor', description: '', route: './purchases/by-supplier' },
      ],
    },
    {
      id: 'customers',
      label: 'Clientes',
      description: 'Análisis de clientes, adquisición y CLV',
      icon: 'users',
      route: './customers',
      color: 'bg-cyan-500',
      items: [
        { id: 'summary', label: 'Resumen de Clientes', description: '', route: './customers/summary' },
        { id: 'acquisition', label: 'Adquisición', description: '', route: './customers/acquisition' },
        { id: 'abandoned-carts', label: 'Carritos Abandonados', description: '', route: './customers/abandoned-carts' },
      ],
    },
    {
      id: 'reviews',
      label: 'Reseñas',
      description: 'Ratings, comentarios y satisfacción',
      icon: 'star',
      route: './reviews',
      color: 'bg-yellow-500',
      items: [
        { id: 'summary', label: 'Resumen de Reseñas', description: '', route: './reviews/summary' },
      ],
    },
    {
      id: 'expenses',
      label: 'Gastos',
      description: 'Gastos operativos, categorías y tendencias',
      icon: 'wallet',
      route: './expenses',
      color: 'bg-red-500',
      items: [
        { id: 'summary', label: 'Resumen de Gastos', description: '', route: './expenses/summary' },
        { id: 'by-category', label: 'Gastos por Categoría', description: '', route: './expenses/by-category' },
      ],
    },
    {
      id: 'financial',
      label: 'Financiero',
      description: 'P&L, impuestos, reembolsos y conciliación',
      icon: 'landmark',
      route: './financial',
      color: 'bg-indigo-500',
      items: [
        { id: 'profit-loss', label: 'Estado de Resultados', description: '', route: './financial/profit-loss' },
        { id: 'tax-summary', label: 'Resumen de Impuestos', description: '', route: './financial/tax-summary' },
        { id: 'refunds', label: 'Reembolsos', description: '', route: './financial/refunds' },
      ],
    },
  ];

  quickLinks = [
    { label: 'Resumen de Ventas', icon: 'trending-up', route: './sales/summary' },
    { label: 'Stock Bajo', icon: 'alert-triangle', route: './inventory/low-stock' },
    { label: 'Top Productos', icon: 'award', route: './products/top-sellers' },
    { label: 'P&L', icon: 'landmark', route: './financial/profit-loss' },
  ];
}
