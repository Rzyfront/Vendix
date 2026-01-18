import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfigFacade } from '../../../../core/store/config';
import { ThemeService } from '../../../../core/services';
import { LandingLayoutComponent } from '../../../../shared/components/layouts/landing-layout/landing-layout.component';
import { LandingHeroComponent } from '../../components/shared/landing-hero/landing-hero.component';
import { LandingFeaturesComponent } from '../../components/shared/landing-features/landing-features.component';

@Component({
  selector: 'app-store-landing',
  standalone: true,
  imports: [
    CommonModule,
    LandingLayoutComponent,
    LandingHeroComponent,
    LandingFeaturesComponent
  ],
  template: `
    <app-landing-layout 
      [brandName]="storeName" 
      [logoUrl]="branding?.logo?.url">
      
      <!-- Default View Strategy: Composed Components -->
      <ng-container *ngIf="!customLayout">
        <app-landing-hero
          [title]="heroTitle"
          [description]="heroDescription"
          [ctaText]="'Ver Productos'">
        </app-landing-hero>
        
        <app-landing-features 
          *ngIf="features.length" 
          [features]="features">
        </app-landing-features>
      </ng-container>

      <!-- Custom Layout Placeholder (Future Extension) -->
      <ng-container *ngIf="customLayout">
        <!-- Dynamic component loader could go here -->
      </ng-container>

    </app-landing-layout>
  `,
  styleUrls: ['./store-landing.component.scss']
})
export class StoreLandingComponent implements OnInit {
  storeName = 'Store';
  branding: any = {};
  heroTitle = 'Bienvenido';
  heroDescription = '';
  features: any[] = [];
  customLayout = false;

  private configFacade = inject(ConfigFacade);
  private themeService = inject(ThemeService);

  ngOnInit() {
    const appConfig = this.configFacade.getCurrentConfig();
    if (appConfig) {
      const domainConfig = appConfig.domainConfig;
      this.storeName = domainConfig.store_slug || 'Store';
      this.branding = appConfig.branding || {};

      // Map custom config to view properties
      const customConfig = domainConfig.customConfig || {};
      this.heroTitle = customConfig.title || `Bienvenido a ${this.storeName}`;
      this.heroDescription = customConfig.description || 'Explora nuestros productos y servicios.';
      this.features = this.mapFeatures(customConfig.features || {});

      // Apply domain branding colors to CSS variables
      if (appConfig.branding) {
        this.themeService.applyBranding(appConfig.branding);
      }
    }
  }

  private mapFeatures(features: any): any[] {
    // Simple mapper for now, similar to OrgLanding
    // This allows enabling/disabling standard sections
    const featureList = [];
    if (features.promotions) featureList.push({ title: 'Ofertas', description: 'Las mejores promociones del mes.' });
    if (features.newArrivals) featureList.push({ title: 'Novedades', description: 'Lo último en nuestro catálogo.' });
    return featureList;
  }
}
