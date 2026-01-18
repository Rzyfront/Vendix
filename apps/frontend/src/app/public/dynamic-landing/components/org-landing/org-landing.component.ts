import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfigFacade } from '../../../../core/store/config';
import { ThemeService } from '../../../../core/services';
import { LandingLayoutComponent } from '../../../../shared/components/layouts/landing-layout/landing-layout.component';
import { LandingHeroComponent } from '../../components/shared/landing-hero/landing-hero.component';
import { LandingFeaturesComponent } from '../../components/shared/landing-features/landing-features.component';

@Component({
  selector: 'app-org-landing',
  standalone: true,
  imports: [
    CommonModule,
    LandingLayoutComponent,
    LandingHeroComponent,
    LandingFeaturesComponent
  ],
  template: `
    <app-landing-layout 
      [brandName]="organizationName" 
      [logoUrl]="branding?.logo?.url">
      
      <app-landing-hero
        [title]="organizationName"
        [description]="organizationDescription"
        [ctaText]="'Explorar Tienda'">
      </app-landing-hero>

      <app-landing-features 
        *ngIf="features.length" 
        [features]="features">
      </app-landing-features>

    </app-landing-layout>
  `,
  styleUrls: ['./org-landing.component.scss'],
})
export class OrgLandingComponent implements OnInit {
  organizationName = 'Organización';
  organizationDescription = '';
  branding: any = {};
  features: any[] = [];

  private configFacade = inject(ConfigFacade);
  private themeService = inject(ThemeService);

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

    // Apply domain branding colors to CSS variables
    if (appConfig.branding) {
      this.themeService.applyBranding(appConfig.branding);
    }
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
}

