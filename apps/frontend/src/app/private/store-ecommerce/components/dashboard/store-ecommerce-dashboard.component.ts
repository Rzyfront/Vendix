import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

@Component({
  selector: 'app-store-ecommerce-dashboard',
  standalone: true,
  imports: [CommonModule, CardComponent, ButtonComponent],
  template: `
    <div class="store-ecommerce-dashboard">
      <header class="dashboard-header">
        <h1>E-commerce de Tienda</h1>
        <p>Gestiona las ventas y productos de tu tienda específica</p>
      </header>

      <div class="dashboard-stats">
        <div class="stats-grid">
          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">💰</div>
              <div class="stat-info">
                <h3>{{ dailyRevenue | currency:'USD':'symbol':'1.0-0' }}</h3>
                <p>Ingresos del Día</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">🛒</div>
              <div class="stat-info">
                <h3>{{ todayOrders }}</h3>
                <p>Pedidos Hoy</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">📦</div>
              <div class="stat-info">
                <h3>{{ lowStockProducts }}</h3>
                <p>Productos con Stock Bajo</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">👥</div>
              <div class="stat-info">
                <h3>{{ newCustomers }}</h3>
                <p>Clientes Nuevos</p>
              </div>
            </div>
          </app-card>
        </div>
      </div>

      <div class="dashboard-content">
        <div class="content-grid">
          <!-- Gestión de Productos -->
          <app-card class="content-card">
            <div class="content-header">
              <h3>Gestión de Productos</h3>
              <p>Administra el catálogo de productos de tu tienda</p>
            </div>
            <div class="content-actions">
              <app-button variant="primary" size="lg">
                Ver Productos
              </app-button>
              <app-button variant="outline" size="lg">
                Agregar Producto
              </app-button>
            </div>
          </app-card>

          <!-- Pedidos -->
          <app-card class="content-card">
            <div class="content-header">
              <h3>Gestión de Pedidos</h3>
              <p>Revisa y procesa los pedidos de clientes</p>
            </div>
            <div class="content-actions">
              <app-button variant="primary" size="lg">
                Ver Pedidos
              </app-button>
              <app-button variant="outline" size="lg">
                Procesar Envíos
              </app-button>
            </div>
          </app-card>

          <!-- Inventario -->
          <app-card class="content-card">
            <div class="content-header">
              <h3>Control de Inventario</h3>
              <p>Gestiona el stock y niveles de productos</p>
            </div>
            <div class="content-actions">
              <app-button variant="primary" size="lg">
                Ver Inventario
              </app-button>
              <app-button variant="outline" size="lg">
                Actualizar Stock
              </app-button>
            </div>
          </app-card>

          <!-- Marketing -->
          <app-card class="content-card">
            <div class="content-header">
              <h3>Marketing</h3>
              <p>Crea promociones y campañas para tu tienda</p>
            </div>
            <div class="content-actions">
              <app-button variant="primary" size="lg">
                Promociones
              </app-button>
              <app-button variant="outline" size="lg">
                Cupones
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
              <div class="order-actions">
                <app-button size="sm" variant="outline">Ver Detalles</app-button>
              </div>
            </div>
          </div>
        </app-card>
      </div>

      <div class="quick-actions">
        <app-card>
          <h3>Acciones Rápidas</h3>
          <div class="actions-grid">
            <app-button variant="primary" size="lg">
              📦 Agregar Producto
            </app-button>
            <app-button variant="secondary" size="lg">
              🎫 Crear Cupón
            </app-button>
            <app-button variant="outline" size="lg">
              📊 Ver Reportes
            </app-button>
            <app-button variant="ghost" size="lg">
              ⚙️ Configuración
            </app-button>
          </div>
        </app-card>
      </div>
    </div>
  `,
  styleUrls: ['./store-ecommerce-dashboard.component.scss']
})
export class StoreEcommerceDashboardComponent implements OnInit {
  dailyRevenue = 1850;
  todayOrders = 24;
  lowStockProducts = 8;
  newCustomers = 5;

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
      status: 'shipped',
      time: 'Hace 2 horas'
    }
  ];

  ngOnInit() {
    // En producción, cargar datos reales desde servicios
  }
}