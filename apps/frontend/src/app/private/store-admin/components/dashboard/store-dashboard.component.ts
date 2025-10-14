import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

@Component({
  selector: 'app-store-dashboard',
  standalone: true,
  imports: [CommonModule, CardComponent, ButtonComponent],
  template: `
    <div class="store-dashboard">
      <header class="dashboard-header">
        <h1>Panel de Tienda</h1>
        <p>Gestiona tu tienda y productos</p>
      </header>

      <div class="dashboard-stats">
        <div class="stats-grid">
          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">📦</div>
              <div class="stat-info">
                <h3>{{ productsCount }}</h3>
                <p>Productos Activos</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">🛒</div>
              <div class="stat-info">
                <h3>{{ ordersCount }}</h3>
                <p>Pedidos Hoy</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">💰</div>
              <div class="stat-info">
                <h3>{{ revenue | currency:'USD':'symbol':'1.0-0' }}</h3>
                <p>Ingresos del Día</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">👥</div>
              <div class="stat-info">
                <h3>{{ customersCount }}</h3>
                <p>Clientes Nuevos</p>
              </div>
            </div>
          </app-card>
        </div>
      </div>

      <div class="dashboard-actions">
        <div class="action-grid">
          <app-card class="action-card">
            <div class="action-content">
              <h3>Gestión de Productos</h3>
              <p>Administra el catálogo de productos de tu tienda</p>
              <app-button variant="primary" size="lg">
                Gestionar Productos
              </app-button>
            </div>
          </app-card>

          <app-card class="action-card">
            <div class="action-content">
              <h3>Pedidos</h3>
              <p>Revisa y gestiona los pedidos de clientes</p>
              <app-button variant="primary" size="lg">
                Ver Pedidos
              </app-button>
            </div>
          </app-card>

          <app-card class="action-card">
            <div class="action-content">
              <h3>Inventario</h3>
              <p>Controla el stock y niveles de inventario</p>
              <app-button variant="primary" size="lg">
                Gestionar Inventario
              </app-button>
            </div>
          </app-card>

          <app-card class="action-card">
            <div class="action-content">
              <h3>Configuración de Tienda</h3>
              <p>Personaliza la apariencia y configuración</p>
              <app-button variant="primary" size="lg">
                Configurar
              </app-button>
            </div>
          </app-card>
        </div>
      </div>

      <div class="recent-orders">
        <app-card>
          <h3>Pedidos Recientes</h3>
          <div class="orders-list">
            <div *ngFor="let order of recentOrders" class="order-item">
              <div class="order-info">
                <span class="order-id">#{{ order.id }}</span>
                <span class="order-customer">{{ order.customer }}</span>
                <span class="order-amount">{{ order.amount | currency:'USD':'symbol':'1.2-2' }}</span>
                <span class="order-status" [class]="order.status">{{ order.status }}</span>
              </div>
              <span class="order-time">{{ order.time }}</span>
            </div>
          </div>
        </app-card>
      </div>
    </div>
  `,
  styleUrls: ['./store-dashboard.component.scss']
})
export class StoreDashboardComponent implements OnInit {
  productsCount = 156;
  ordersCount = 24;
  revenue = 1850;
  customersCount = 8;

  recentOrders = [
    {
      id: 'ORD-001',
      customer: 'Ana Rodríguez',
      amount: 89.99,
      status: 'completed',
      time: 'Hace 15 min'
    },
    {
      id: 'ORD-002',
      customer: 'Carlos Méndez',
      amount: 145.50,
      status: 'processing',
      time: 'Hace 30 min'
    },
    {
      id: 'ORD-003',
      customer: 'Laura Torres',
      amount: 67.25,
      status: 'pending',
      time: 'Hace 1 hora'
    },
    {
      id: 'ORD-004',
      customer: 'Miguel Santos',
      amount: 210.75,
      status: 'completed',
      time: 'Hace 2 horas'
    }
  ];

  ngOnInit() {
    // En producción, cargar datos reales desde servicios
  }
}