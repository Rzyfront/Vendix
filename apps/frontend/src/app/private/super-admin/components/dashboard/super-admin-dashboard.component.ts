import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

@Component({
  selector: 'app-super-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, ButtonComponent],
  template: `
    <div class="super-admin-dashboard">
      <header class="dashboard-header">
        <h1>Panel de Super Administrador</h1>
        <p>Gestión central de la plataforma Vendix</p>
      </header>

      <div class="stats-grid">
        <app-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon">🏢</div>
            <div class="stat-info">
              <h3>{{ organizationsCount }}</h3>
              <p>Organizaciones</p>
            </div>
          </div>
        </app-card>

        <app-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon">🏪</div>
            <div class="stat-info">
              <h3>{{ storesCount }}</h3>
              <p>Tiendas</p>
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
      </div>

      <div class="actions-grid">
        <app-card class="action-card">
          <h3>Gestión de Organizaciones</h3>
          <p>Administra todas las organizaciones registradas en la plataforma</p>
          <app-button 
            [routerLink]="['/super-admin/organizations']" 
            variant="primary"
          >
            Gestionar Organizaciones
          </app-button>
        </app-card>

        <app-card class="action-card">
          <h3>Gestión de Usuarios</h3>
          <p>Administra usuarios globales y permisos del sistema</p>
          <app-button 
            [routerLink]="['/super-admin/users']" 
            variant="primary"
          >
            Gestionar Usuarios
          </app-button>
        </app-card>

        <app-card class="action-card">
          <h3>Configuración del Sistema</h3>
          <p>Configuración global de la plataforma Vendix</p>
          <app-button 
            [routerLink]="['/super-admin/settings']" 
            variant="primary"
          >
            Configurar Sistema
          </app-button>
        </app-card>

        <app-card class="action-card">
          <h3>Reportes y Analytics</h3>
          <p>Métricas y reportes de toda la plataforma</p>
          <app-button variant="secondary">
            Ver Reportes
          </app-button>
        </app-card>
      </div>

      <div class="recent-activities">
        <app-card>
          <h3>Actividad Reciente</h3>
          <div class="activities-list">
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
  styleUrls: ['./super-admin-dashboard.component.scss']
})
export class SuperAdminDashboardComponent implements OnInit {
  organizationsCount = 0;
  storesCount = 0;
  usersCount = 0;
  revenue = 0;

  recentActivities = [
    {
      icon: '🏢',
      description: 'Nueva organización registrada: TechCorp',
      time: 'Hace 2 horas'
    },
    {
      icon: '👥',
      description: 'Usuario admin creado para FashionStore',
      time: 'Hace 4 horas'
    },
    {
      icon: '💰',
      description: 'Pago mensual procesado: $1,200.00',
      time: 'Hace 1 día'
    },
    {
      icon: '🏪',
      description: 'Nueva tienda creada: Electronics Hub',
      time: 'Hace 2 días'
    }
  ];

  ngOnInit() {
    // Simular carga de datos
    this.loadDashboardData();
  }

  private loadDashboardData() {
    // En producción, estos datos vendrían de una API
    setTimeout(() => {
      this.organizationsCount = 15;
      this.storesCount = 42;
      this.usersCount = 287;
      this.revenue = 12500;
    }, 1000);
  }
}