import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ButtonComponent } from '../../../shared/components/button/button.component';

@Component({
  selector: 'app-store-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonComponent],
  template: `
    <div class="store-admin-layout">
      <!-- Header -->
      <header class="layout-header">
        <div class="header-content">
          <div class="brand-section">
            <div class="logo">
              <img src="/assets/vlogo.png" alt="Vendix" class="logo-image">
              <span class="brand-name">Mi Tienda</span>
            </div>
          </div>
          
          <nav class="main-nav">
            <a routerLink="/store/dashboard" routerLinkActive="active" class="nav-link">
              Dashboard
            </a>
            <a routerLink="/store/products" routerLinkActive="active" class="nav-link">
              Productos
            </a>
            <a routerLink="/store/orders" routerLinkActive="active" class="nav-link">
              Pedidos
            </a>
            <a routerLink="/store/customers" routerLinkActive="active" class="nav-link">
              Clientes
            </a>
            <a routerLink="/store/settings" routerLinkActive="active" class="nav-link">
              Configuración
            </a>
          </nav>

          <div class="user-section">
            <div class="user-info">
              <span class="user-name">Admin Tienda</span>
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
            <a routerLink="/store/dashboard" routerLinkActive="active" class="sidebar-link">
              📊 Dashboard
            </a>
            <a routerLink="/store/products" routerLinkActive="active" class="sidebar-link">
              📦 Productos
            </a>
            <a routerLink="/store/categories" routerLinkActive="active" class="sidebar-link">
              🏷️ Categorías
            </a>
            <a routerLink="/store/inventory" routerLinkActive="active" class="sidebar-link">
              📋 Inventario
            </a>
            <a routerLink="/store/orders" routerLinkActive="active" class="sidebar-link">
              🛒 Pedidos
            </a>
            
            <h4 class="sidebar-title">Clientes</h4>
            <a routerLink="/store/customers" routerLinkActive="active" class="sidebar-link">
              👥 Clientes
            </a>
            <a routerLink="/store/reviews" routerLinkActive="active" class="sidebar-link">
              ⭐ Reseñas
            </a>
            
            <h4 class="sidebar-title">Marketing</h4>
            <a routerLink="/store/promotions" routerLinkActive="active" class="sidebar-link">
              🎯 Promociones
            </a>
            <a routerLink="/store/coupons" routerLinkActive="active" class="sidebar-link">
              🎫 Cupones
            </a>
            
            <h4 class="sidebar-title">Configuración</h4>
            <a routerLink="/store/settings" routerLinkActive="active" class="sidebar-link">
              ⚙️ Configuración
            </a>
            <a routerLink="/store/appearance" routerLinkActive="active" class="sidebar-link">
              🎨 Apariencia
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
          <p>&copy; 2024 Vendix - Panel de Tienda</p>
          <div class="footer-links">
            <a href="/help">Ayuda</a>
            <a href="/support">Soporte</a>
            <a href="/privacy">Privacidad</a>
          </div>
        </div>
      </footer>
    </div>
  `,
  styleUrls: ['./store-admin-layout.component.scss']
})
export class StoreAdminLayoutComponent {}