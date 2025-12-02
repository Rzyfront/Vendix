import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfigFacade } from '../../../../core/store/config';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../shared/components/card/card.component';

@Component({
  selector: 'app-org-landing',
  standalone: true,
  imports: [CommonModule, ButtonComponent, CardComponent],
  template: `
    <div
      class="org-landing-container"
      [style.background]="branding?.background"
    >
      <header class="org-header">
        <div class="org-logo">
          <img
            *ngIf="branding?.logo"
            [src]="branding.logo"
            [alt]="organizationName + ' Logo'"
            class="logo-image"
          />
          <h1 *ngIf="!branding?.logo">{{ organizationName }}</h1>
        </div>
        <nav class="org-nav">
          <button class="nav-button" (click)="navigateToLogin()">
            Iniciar Sesión
          </button>
          <button class="nav-button primary" (click)="navigateToShop()">
            Ir a Tienda
          </button>
        </nav>
      </header>

      <main class="org-main">
        <section class="hero-section">
          <h2>{{ organizationName }}</h2>
          <p *ngIf="organizationDescription" class="org-description">
            {{ organizationDescription }}
          </p>
          <div class="cta-buttons">
            <app-button (click)="navigateToShop()" variant="primary">
              Explorar Tienda
            </app-button>
            <app-button (click)="navigateToLogin()" variant="secondary">
              Acceso Miembros
            </app-button>
          </div>
        </section>

        <section *ngIf="features?.length" class="features-section">
          <h3>Características</h3>
          <div class="features-grid">
            <app-card *ngFor="let feature of features" class="feature-card">
              <h4>{{ feature.title }}</h4>
              <p>{{ feature.description }}</p>
            </app-card>
          </div>
        </section>
      </main>
    </div>
  `,
  styleUrls: ['./org-landing.component.scss'],
})
export class OrgLandingComponent implements OnInit {
  organizationName = 'Organización';
  organizationDescription = '';
  branding: any = {};
  features: any[] = [];

  private configFacade = inject(ConfigFacade);

  ngOnInit() {
    const appConfig = this.configFacade.getCurrentConfig();
    if (!appConfig) {
      console.warn(
        '[ORG-LANDING] App config not available, using default values',
      );
      this.loadDefaultData();
      return;
    }

    const domainConfig = appConfig.domainConfig;
    this.organizationName = domainConfig.organization_slug || 'Organización';
    this.branding = appConfig.branding || {};
    this.organizationDescription =
      appConfig.domainConfig.customConfig?.description || '';
    this.features = this.mapFeatures(
      appConfig.domainConfig.customConfig?.features || {},
    );
  }

  private loadDefaultData() {
    this.features = this.mapFeatures({});
  }

  private mapFeatures(features: any): any[] {
    const featureMap: {
      [key: string]: { title: string; description: string };
    } = {
      onboarding: {
        title: 'Onboarding',
        description: 'Configuración rápida y guiada',
      },
      multiStore: {
        title: 'Multi-Tienda',
        description: 'Gestiona múltiples tiendas',
      },
      userManagement: {
        title: 'Gestión de Usuarios',
        description: 'Control de accesos y roles',
      },
      analytics: {
        title: 'Analytics',
        description: 'Métricas y reportes detallados',
      },
      inventory: {
        title: 'Inventario',
        description: 'Control de stock en tiempo real',
      },
      pos: { title: 'Punto de Venta', description: 'Sistema POS integrado' },
      orders: { title: 'Pedidos', description: 'Gestión completa de órdenes' },
      customers: {
        title: 'Clientes',
        description: 'Base de datos de clientes',
      },
      reports: { title: 'Reportes', description: 'Reportes personalizables' },
    };

    return Object.entries(features)
      .filter(([key, enabled]) => enabled && featureMap[key])
      .map(([key]) => featureMap[key]);
  }

  navigateToLogin() {
    window.location.href = '/auth/login';
  }

  navigateToShop() {
    window.location.href = '/shop';
  }
}
