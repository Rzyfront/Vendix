import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfigFacade } from '../../../../core/store/config';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

@Component({
  selector: 'app-store-landing',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <div
      class="store-landing-container"
      [style.background]="branding?.background"
    >
      <header class="store-header">
        <div class="store-logo">
          <img
            *ngIf="branding?.logo"
            [src]="branding.logo"
            [alt]="storeName + ' Logo'"
            class="logo-image"
          />
          <h1 *ngIf="!branding?.logo">{{ storeName }}</h1>
        </div>
        <nav class="store-nav">
          <button class="nav-button" (click)="navigateToLogin()">
            Acceso Empleados
          </button>
          <button class="nav-button primary" (click)="navigateToShop()">
            Comprar Ahora
          </button>
        </nav>
      </header>

      <main class="store-main">
        <section class="hero-section">
          <h2>Bienvenido a {{ storeName }}</h2>
          <p *ngIf="storeDescription" class="store-description">
            {{ storeDescription }}
          </p>
          <div class="cta-buttons">
            <app-button (click)="navigateToShop()" variant="primary" size="lg">
              Explorar Productos
            </app-button>
            <app-button
              (click)="navigateToLogin()"
              variant="secondary"
              size="lg"
            >
              Acceso Staff
            </app-button>
          </div>
        </section>

        <section *ngIf="showFeaturedProducts" class="featured-section">
          <h3>Productos Destacados</h3>
          <div class="products-grid">
            <div *ngFor="let product of featuredProducts" class="product-card">
              <div class="product-image">
                <img
                  [src]="product.image"
                  [alt]="product.name"
                  class="product-img"
                />
              </div>
              <div class="product-info">
                <h4>{{ product.name }}</h4>
                <p class="product-price">
                  {{ product.price | currency: 'USD' : 'symbol' : '1.2-2' }}
                </p>
                <app-button (click)="addToCart(product)" size="sm">
                  Agregar al Carrito
                </app-button>
              </div>
            </div>
          </div>
        </section>

        <section class="store-info">
          <div class="info-grid">
            <div class="info-item">
              <h4>Horario de Atención</h4>
              <p>{{ storeHours }}</p>
            </div>
            <div class="info-item">
              <h4>Contacto</h4>
              <p>{{ contactInfo }}</p>
            </div>
            <div class="info-item">
              <h4>Ubicación</h4>
              <p>{{ locationInfo }}</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  `,
  styleUrls: ['./store-landing.component.scss'],
})
export class StoreLandingComponent implements OnInit {
  storeName = 'Tienda';
  storeDescription = '';
  branding: any = {};
  featuredProducts: any[] = [];
  storeHours = 'Lunes a Viernes: 9:00 AM - 6:00 PM';
  contactInfo = 'Tel: +1 234 567 8900 | Email: info@tienda.com';
  locationInfo = 'Dirección de la tienda';

  get showFeaturedProducts(): boolean {
    return this.featuredProducts.length > 0;
  }

  private configFacade = inject(ConfigFacade);

  ngOnInit() {
    const appConfig = this.configFacade.getCurrentConfig();
    if (!appConfig) {
      console.warn(
        '[STORE-LANDING] App config not available, using default values',
      );
      this.loadDefaultData();
      return;
    }

    const domainConfig = appConfig.domainConfig;
    this.storeName = domainConfig.store_slug || 'Tienda';
    this.branding = appConfig.branding || {};
    this.storeDescription =
      appConfig.domainConfig.customConfig?.description || '';

    this.featuredProducts = this.generateSampleProducts();
  }

  private loadDefaultData() {
    this.featuredProducts = this.generateSampleProducts();
  }

  private generateSampleProducts(): any[] {
    return [
      {
        id: 1,
        name: 'Producto Destacado 1',
        price: 29.99,
        image: '/assets/images/product-placeholder.jpg',
      },
      {
        id: 2,
        name: 'Producto Destacado 2',
        price: 39.99,
        image: '/assets/images/product-placeholder.jpg',
      },
      {
        id: 3,
        name: 'Producto Destacado 3',
        price: 49.99,
        image: '/assets/images/product-placeholder.jpg',
      },
    ];
  }

  navigateToLogin() {
    window.location.href = '/auth/login';
  }
  navigateToShop() {
    window.location.href = '/shop';
  }
  addToCart(product: any) {
    console.log('Agregar al carrito:', product);
  }
}
