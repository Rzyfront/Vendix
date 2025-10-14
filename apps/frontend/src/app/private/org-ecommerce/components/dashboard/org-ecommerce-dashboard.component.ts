import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

@Component({
  selector: 'app-org-ecommerce-dashboard',
  standalone: true,
  imports: [CommonModule, CardComponent, ButtonComponent],
  template: `
    <div class="org-ecommerce-dashboard">
      <header class="dashboard-header">
        <h1>E-commerce de Organización</h1>
        <p>Gestiona las ventas y productos de todas tus tiendas</p>
      </header>

      <div class="dashboard-stats">
        <div class="stats-grid">
          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">💰</div>
              <div class="stat-info">
                <h3>{{ totalRevenue | currency:'USD':'symbol':'1.0-0' }}</h3>
                <p>Ingresos Totales</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">🛒</div>
              <div class="stat-info">
                <h3>{{ totalOrders }}</h3>
                <p>Pedidos Totales</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">🏪</div>
              <div class="stat-info">
                <h3>{{ activeStores }}</h3>
                <p>Tiendas Activas</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">📦</div>
              <div class="stat-info">
                <h3>{{ totalProducts }}</h3>
                <p>Productos Totales</p>
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
              <p>Administra el catálogo de productos de tu organización</p>
            </div>
            <div class="content-actions">
              <app-button variant="primary" size="lg">
                Ver Catálogo
              </app-button>
              <app-button variant="outline" size="lg">
                Agregar Producto
              </app-button>
            </div>
          </app-card>

          <!-- Pedidos y Ventas -->
          <app-card class="content-card">
            <div class="content-header">
              <h3>Pedidos y Ventas</h3>
              <p>Revisa y gestiona los pedidos de todas las tiendas</p>
            </div>
            <div class="content-actions">
              <app-button variant="primary" size="lg">
                Ver Pedidos
              </app-button>
              <app-button variant="outline" size="lg">
                Reportes de Ventas
              </app-button>
            </div>
          </app-card>

          <!-- Inventario Central -->
          <app-card class="content-card">
            <div class="content-header">
              <h3>Inventario Central</h3>
              <p>Controla el stock y distribución entre tiendas</p>
            </div>
            <div class="content-actions">
              <app-button variant="primary" size="lg">
                Gestionar Inventario
              </app-button>
              <app-button variant="outline" size="lg">
                Transferencias
              </app-button>
            </div>
          </app-card>

          <!-- Marketing y Promociones -->
          <app-card class="content-card">
            <div class="content-header">
              <h3>Marketing y Promociones</h3>
              <p>Crea campañas y promociones para todas las tiendas</p>
            </div>
            <div class="content-actions">
              <app-button variant="primary" size="lg">
                Campañas
              </app-button>
              <app-button variant="outline" size="lg">
                Cupones
              </app-button>
            </div>
          </app-card>
        </div>
      </div>

      <div class="recent-activity">
        <app-card>
          <h3>Actividad Reciente de Tiendas</h3>
          <div class="activity-list">
            <div *ngFor="let activity of storeActivities" class="activity-item">
              <div class="activity-store">{{ activity.store }}</div>
              <div class="activity-details">
                <p class="activity-description">{{ activity.description }}</p>
                <span class="activity-time">{{ activity.time }}</span>
              </div>
              <div class="activity-amount">{{ activity.amount | currency:'USD':'symbol':'1.2-2' }}</div>
            </div>
          </div>
        </app-card>
      </div>
    </div>
  `,
  styleUrls: ['./org-ecommerce-dashboard.component.scss']
})
export class OrgEcommerceDashboardComponent implements OnInit {
  totalRevenue = 125000;
  totalOrders = 3421;
  activeStores = 8;
  totalProducts = 1560;

  storeActivities = [
    {
      store: 'Fashion Store',
      description: 'Nuevo pedido completado',
      amount: 89.99,
      time: 'Hace 15 min'
    },
    {
      store: 'Tech Corner',
      description: 'Producto agregado al catálogo',
      amount: 0,
      time: 'Hace 30 min'
    },
    {
      store: 'Home Decor',
      description: 'Venta mayorista procesada',
      amount: 1250.50,
      time: 'Hace 1 hora'
    },
    {
      store: 'Sports Gear',
      description: 'Actualización de inventario',
      amount: 0,
      time: 'Hace 2 horas'
    }
  ];

  ngOnInit() {
    // En producción, cargar datos reales desde servicios
  }
}