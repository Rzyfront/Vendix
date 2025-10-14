import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ButtonComponent } from '../../../shared/components/button/button.component';

@Component({
  selector: 'app-organization-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonComponent],
  template: `
    <div class="organization-admin-layout">
      <!-- Header -->
      <header class="layout-header">
        <div class="header-content">
          <div class="brand-section">
            <div class="logo">
              <img src="/assets/vlogo.png" alt="Vendix" class="logo-image">
              <span class="brand-name">Organización</span>
            </div>
          </div>
          
          <nav class="main-nav">
            <a routerLink="/organization/dashboard" routerLinkActive="active" class="nav-link">
              Dashboard
            </a>
            <a routerLink="/organization/stores" routerLinkActive="active" class="nav-link">
              Tiendas
            </a>
            <a routerLink="/organization/users" routerLinkActive="active" class="nav-link">
              Usuarios
            </a>
            <a routerLink="/organization/reports" routerLinkActive="active" class="nav-link">
              Reportes
            </a>
            <a routerLink="/organization/settings" routerLinkActive="active" class="nav-link">
              Configuración
            </a>
          </nav>

          <div class="user-section">
            <div class="user-info">
              <span class="user-name">Admin Organización</span>
              <span class="user-role">Administrador</span>
            </div>
            <app-button variant="ghost" size="sm">
              Cerrar Sesión
            </app-button>
          </div>
        </div>
      </header>

      <!-- Main Content -->
      <main class="layout-main">
        <div class="sidebar">
          <nav class="sidebar-nav">
            <h4 class="sidebar-title">Gestión</h4>
            <a routerLink="/organization/dashboard" routerLinkActive="active" class="sidebar-link">
              📊 Dashboard
            </a>
            <a routerLink="/organization/stores" routerLinkActive="active" class="sidebar-link">
              🏪 Tiendas
            </a>
            <a routerLink="/organization/users" routerLinkActive="active" class="sidebar-link">
              👥 Usuarios
            </a>
            <a routerLink="/organization/products" routerLinkActive="active" class="sidebar-link">
              📦 Productos
            </a>
            <a routerLink="/organization/orders" routerLinkActive="active" class="sidebar-link">
              🛒 Pedidos
            </a>
            
            <h4 class="sidebar-title">Análisis</h4>
            <a routerLink="/organization/reports" routerLinkActive="active" class="sidebar-link">
              📈 Reportes
            </a>
            <a routerLink="/organization/analytics" routerLinkActive="active" class="sidebar-link">
              📊 Analytics
            </a>
            
            <h4 class="sidebar-title">Configuración</h4>
            <a routerLink="/organization/settings" routerLinkActive="active" class="sidebar-link">
              ⚙️ Configuración
            </a>
            <a routerLink="/organization/billing" routerLinkActive="active" class="sidebar-link">
              💳 Facturación
            </a>
          </nav>
        </div>

        <div class="content-area">
          <router-outlet></router-outlet>
        </div>
      </main>

      <!-- Footer -->
      <footer class="layout-footer">
        <div class="footer-content">
          <p>&copy; 2024 Vendix - Panel de Organización</p>
          <div class="footer-links">
            <a href="/help">Ayuda</a>
            <a href="/support">Soporte</a>
            <a href="/privacy">Privacidad</a>
          </div>
        </div>
      </footer>
    </div>
  `,
  styleUrls: ['./organization-admin-layout.component.scss']
})
export class OrganizationAdminLayoutComponent {}