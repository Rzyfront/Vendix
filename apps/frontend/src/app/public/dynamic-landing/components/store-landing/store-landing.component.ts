import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfigFacade } from '../../../../core/store/config';
import { ThemeService } from '../../../../core/services';
import { LandingLayoutComponent } from '../../../../shared/components/layouts/landing-layout/landing-layout.component';
import { DynamicHeroCarouselComponent } from '../shared/dynamic-hero-carousel/dynamic-hero-carousel.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-store-landing',
  standalone: true,
  imports: [
    CommonModule,
    LandingLayoutComponent,
    DynamicHeroCarouselComponent,
    IconComponent,
  ],
  template: `
    <app-landing-layout [brandName]="storeName" [logoUrl]="branding?.logo?.url">
      <!-- Hero Section with Carousel -->
      <section class="relative h-screen">
        <app-dynamic-hero-carousel
          [slides]="heroSlides"
        ></app-dynamic-hero-carousel>
      </section>

      <!-- Features Section -->
      <section
        id="features"
        class="min-h-screen bg-[var(--color-surface)] flex items-center py-20"
        *ngIf="features.length"
      >
        <div class="container mx-auto px-4 sm:px-6 lg:px-8">
          <div class="text-center mb-16">
            <div
              class="inline-flex items-center gap-2 bg-[var(--color-primary)] px-4 py-2 rounded-full mb-6"
            >
              <span
                class="w-2 h-2 bg-[var(--color-accent)] rounded-full"
              ></span>
              <span class="text-sm font-medium text-[var(--color-accent)]"
                >Nuestra Tienda</span
              >
            </div>
            <h2
              class="text-4xl md:text-5xl font-bold text-[var(--color-text-primary)] mb-6 tracking-tight"
            >
              Bienvenido a<br />
              <span class="text-[var(--color-primary)]">{{ storeName }}</span>
            </h2>
            <p
              class="text-xl text-[var(--color-text-secondary)] max-w-3xl mx-auto leading-relaxed"
            >
              {{ heroDescription || 'Explora lo que tenemos para ofrecerte.' }}
            </p>
          </div>

          <div
            class="grid md:grid-cols-2 lg:grid-cols-4 gap-2 md:p-4 max-w-7xl mx-auto"
          >
            <div
              *ngFor="let feature of features"
              class="group bg-white p-2 md:p-6 rounded-2xl border border-[var(--color-border)] hover:border-[var(--color-primary)]/30 hover:shadow-lg transition-all duration-300"
            >
              <div
                class="w-12 h-12 bg-[var(--color-primary-light)] rounded-xl flex items-center justify-center mb-6 group-hover:scale-105 transition-transform duration-300"
              >
                <app-icon
                  name="star"
                  [size]="24"
                  color="var(--color-primary)"
                ></app-icon>
              </div>
              <h3
                class="text-xl font-semibold text-[var(--color-text-primary)] mb-3"
              >
                {{ feature.title }}
              </h3>
              <p class="text-[var(--color-text-secondary)] leading-relaxed">
                {{ feature.description }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- CTA Section -->
      <section
        class="min-h-[50vh] bg-[var(--color-primary)] relative overflow-hidden flex items-center"
      >
        <div
          class="container mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10"
        >
          <h2
            class="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight"
          >
            Acceso Personal
          </h2>
          <p
            class="text-xl text-white/90 mb-10 max-w-3xl mx-auto leading-relaxed"
          >
            Ingresa al sistema de punto de venta y gestión.
          </p>
          <div class="flex flex-col sm:flex-row gap-2 md:gap-4 justify-center">
            <a
              href="/auth/login"
              class="bg-white text-[var(--color-primary)] px-8 py-4 rounded-xl font-semibold hover:bg-gray-50 hover:shadow-xl transition-all duration-300"
            >
              Iniciar Sesión
            </a>
          </div>
        </div>
        <!-- Decorative elements -->
        <div class="absolute top-0 left-0 w-full h-full opacity-10">
          <div
            class="absolute top-10 left-10 w-20 h-20 bg-white rounded-full"
          ></div>
          <div
            class="absolute bottom-10 right-10 w-32 h-32 bg-white rounded-full"
          ></div>
          <div
            class="absolute top-1/2 right-1/4 w-16 h-16 bg-white rounded-full"
          ></div>
        </div>
      </section>
    </app-landing-layout>
  `,
  styleUrls: ['./store-landing.component.scss'],
})
export class StoreLandingComponent implements OnInit {
  storeName = 'Store';
  branding: any = {};
  heroTitle = 'Bienvenido';
  heroDescription = '';
  features: any[] = [];
  heroSlides: any[] = [];
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
      this.heroDescription =
        customConfig.description || 'Explora nuestros productos y servicios.';
      this.features = this.mapFeatures(customConfig.features || {});

      this.buildHeroSlides();

      // Apply domain branding colors to CSS variables
      if (appConfig.branding) {
        this.themeService.applyBranding(appConfig.branding);
      }
    } else {
      // Fallback defaults
      this.buildHeroSlides();
    }
  }

  private buildHeroSlides() {
    this.heroSlides = [
      {
        image: 'assets/images/carrusel/3.webp',
        message: `Operaciones ${this.storeName}`,
        subtitle:
          'Sistema de gestión operativa y punto de venta para personal autorizado.',
        buttonText: 'Iniciar Turno',
        buttonLink: '/auth/login',
      },
      {
        image: 'assets/images/carrusel/4.webp',
        message: 'Punto de Venta',
        subtitle:
          'Facturación rápida, control de caja e inventario en tiempo real.',
        buttonText: 'Acceder al POS',
        buttonLink: '/auth/login',
      },
    ];
  }

  private mapFeatures(features: any): any[] {
    const featureList = [];
    // Mapeamos features a herramientas operativas
    featureList.push({
      title: 'Punto de Venta',
      description: 'Facturación rápida y eficiente.',
    });
    featureList.push({
      title: 'Control de Caja',
      description: 'Apertura, cierre y arqueos de caja.',
    });
    featureList.push({
      title: 'Inventario Local',
      description: 'Consulta de stock y movimientos.',
    });
    featureList.push({
      title: 'Pedidos',
      description: 'Gestión de órdenes y despachos.',
    });

    return featureList;
  }
}
