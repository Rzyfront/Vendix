import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

@Component({
  selector: 'app-organization-dashboard',
  standalone: true,
  imports: [CommonModule, CardComponent, ButtonComponent],
  template: `
    <div class="organization-dashboard">
      <header class="dashboard-header">
        <h1>Panel de Organización</h1>
        <p>Gestiona tu organización y sus tiendas</p>
      </header>

      <div class="dashboard-stats">
        <div class="stats-grid">
          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">🏪</div>
              <div class="stat-info">
                <h3>{{ storesCount }}</h3>
                <p>Tiendas Activas</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">👥</div>
              <div class="stat-info">
                <h3>{{ usersCount }}</h3>
                <p>Usuarios</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">💰</div>
              <div class="stat-info">
                <h3>{{ revenue | currency:'USD':'symbol':'1.0-0' }}</h3>
                <p>Ingresos Mensuales</p>
              </div>
            </div>
          </app-card>

          <app-card class="stat-card">
            <div class="stat-content">
              <div class="stat-icon">📦</div>
              <div class="stat-info">
                <h3>{{ ordersCount }}</h3>
                <p>Pedidos del Mes</p>
              </div>
            </div>
          </app-card>
        </div>
      </div>

      <div class="dashboard-actions">
        <div class="action-grid">
          <app-card class="action-card">
            <div class="action-content">
              <h3>Gestión de Tiendas</h3>
              <p>Administra todas las tiendas de tu organización</p>
              <app-button variant="primary" size="lg">
                Gestionar Tiendas
              </app-button>
            </div>
          </app-card>

          <app-card class="action-card">
            <div class="action-content">
              <h3>Usuarios y Permisos</h3>
              <p>Gestiona usuarios y sus permisos dentro de la organización</p>
              <app-button variant="primary" size="lg">
                Gestionar Usuarios
              </app-button>
            </div>
          </app-card>

          <app-card class="action-card">
            <div class="action-content">
              <h3>Reportes y Análisis</h3>
              <p>Visualiza reportes y métricas de tu organización</p>
              <app-button variant="primary" size="lg">
                Ver Reportes
              </app-button>
            </div>
          </app-card>

          <app-card class="action-card">
            <div class="action-content">
              <h3>Configuración</h3>
              <p>Configura los parámetros de tu organización</p>
              <app-button variant="primary" size="lg">
                Configurar
              </app-button>
            </div>
          </app-card>
        </div>
      </div>

      <div class="recent-activity">
        <app-card>
          <h3>Actividad Reciente</h3>
          <div class="activity-list">
            <div *ngFor="let activity of recentActivities" class="activity-item">
              <div class="activity-icon">{{ activity.icon }}</div>
              <div class="activity-details">
                <p class="activity-description">{{ activity.description }}</p>
                <span class="activity-time">{{ activity.time }}</span>
              </div>
            </div>
          </div>
        </app-card>
      </div>
    </div>
  `,
  styleUrls: ['./organization-dashboard.component.scss']
})
export class OrganizationDashboardComponent implements OnInit {
  storesCount = 5;
  usersCount = 23;
  revenue = 12500;
  ordersCount = 342;

  recentActivities = [
    {
      icon: '🛒',
      description: 'Nueva tienda "Fashion Store" creada',
      time: 'Hace 2 horas'
    },
    {
      icon: '👤',
      description: 'Usuario "María González" agregado',
      time: 'Hace 4 horas'
    },
    {
      icon: '📊',
      description: 'Reporte mensual generado',
      time: 'Hace 1 día'
    },
    {
      icon: '⚙️',
      description: 'Configuración de organización actualizada',
      time: 'Hace 2 días'
    }
  ];

  ngOnInit() {
    // En producción, cargar datos reales desde servicios
  }
}