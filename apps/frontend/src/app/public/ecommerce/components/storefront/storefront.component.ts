import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppConfigService } from '../../../../core/services/app-config.service';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputComponent } from '../../../../shared/components/input/input.component';

@Component({
  selector: 'app-storefront',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, CardComponent, InputComponent],
  template: `
    <div class="storefront-container">
      <!-- Header -->
      <header class="storefront-header">
        <div class="header-content">
          <div class="store-logo">
            <img 
              *ngIf="branding?.logo" 
              [src]="branding.logo" 
              [alt]="storeName + ' Logo'"
              class="logo-image"
            >
            <h1 *ngIf="!branding?.logo">{{ storeName }}</h1>
          </div>
          
          <nav class="store-nav">
            <div class="search-bar">
              <app-input
                placeholder="Buscar productos..."
                [(ngModel)]="searchTerm"
                (keyup.enter)="onSearch()"
              ></app-input>
            </div>
            <div class="nav-actions">
              <button class="nav-button" (click)="navigateToLogin()">
                Iniciar Sesión
              </button>
              <button class="nav-button cart-button" (click)="toggleCart()">
                🛒 Carrito ({{ cartItems.length }})
              </button>
            </div>
          </nav>
        </div>
      </header>

      <!-- Main Content -->
      <main class="storefront-main">
        <!-- Hero Banner -->
        <section class="hero-banner">
          <div class="banner-content">
            <h2>{{ heroTitle }}</h2>
            <p>{{ heroDescription }}</p>
            <app-button (click)="scrollToProducts()" variant="primary" size="lg">
              Ver Productos
            </app-button>
          </div>
        </section>

        <!-- Categories -->
        <section *ngIf="categories.length" class="categories-section">
          <h3>Categorías</h3>
          <div class="categories-grid">
            <div 
              *ngFor="let category of categories" 
              class="category-card"
              (click)="filterByCategory(category.id)"
              [class.active]="selectedCategory === category.id"
            >
              <div class="category-icon">{{ category.icon }}</div>
              <span>{{ category.name }}</span>
            </div>
          </div>
        </section>

        <!-- Products Grid -->
        <section class="products-section" id="products">
          <div class="section-header">
            <h3>Productos</h3>
            <div class="sort-options">
              <select [(ngModel)]="sortBy" (change)="sortProducts()">
                <option value="name">Ordenar por Nombre</option>
                <option value="price-low">Precio: Menor a Mayor</option>
                <option value="price-high">Precio: Mayor a Menor</option>
                <option value="newest">Más Nuevos</option>
              </select>
            </div>
          </div>

          <div class="products-grid">
            <div *ngFor="let product of filteredProducts" class="product-card">
              <app-card class="product-card-content">
                <div class="product-image">
                  <img [src]="product.image" [alt]="product.name" class="product-img">
                  <div *ngIf="product.onSale" class="sale-badge">Oferta</div>
                </div>
                <div class="product-info">
                  <h4 class="product-name">{{ product.name }}</h4>
                  <p class="product-description">{{ product.description }}</p>
                  <div class="product-pricing">
                    <span class="current-price">{{ product.price | currency:'USD':'symbol':'1.2-2' }}</span>
                    <span *ngIf="product.originalPrice" class="original-price">
                      {{ product.originalPrice | currency:'USD':'symbol':'1.2-2' }}
                    </span>
                  </div>
                  <div class="product-actions">
                    <app-button 
                      (click)="addToCart(product)" 
                      variant="primary" 
                      size="sm"
                      [disabled]="product.stock === 0"
                    >
                      {{ product.stock > 0 ? 'Agregar al Carrito' : 'Sin Stock' }}
                    </app-button>
                    <button class="wishlist-btn" (click)="toggleWishlist(product)">
                      ♡
                    </button>
                  </div>
                </div>
              </app-card>
            </div>
          </div>

          <div *ngIf="filteredProducts.length === 0" class="no-products">
            <p>No se encontraron productos que coincidan con tu búsqueda.</p>
          </div>
        </section>
      </main>

      <!-- Shopping Cart Sidebar -->
      <div *ngIf="showCart" class="cart-sidebar">
        <div class="cart-header">
          <h4>Tu Carrito</h4>
          <button class="close-cart" (click)="toggleCart()">×</button>
        </div>
        <div class="cart-items">
          <div *ngFor="let item of cartItems" class="cart-item">
            <img [src]="item.image" [alt]="item.name" class="cart-item-image">
            <div class="cart-item-info">
              <h5>{{ item.name }}</h5>
              <p>{{ item.price | currency:'USD':'symbol':'1.2-2' }} × {{ item.quantity }}</p>
            </div>
            <div class="cart-item-actions">
              <button (click)="updateQuantity(item, -1)">-</button>
              <span>{{ item.quantity }}</span>
              <button (click)="updateQuantity(item, 1)">+</button>
              <button class="remove-btn" (click)="removeFromCart(item)">×</button>
            </div>
          </div>
        </div>
        <div class="cart-footer">
          <div class="cart-total">
            Total: {{ cartTotal | currency:'USD':'symbol':'1.2-2' }}
          </div>
          <app-button variant="primary" size="lg" (click)="proceedToCheckout()">
            Proceder al Pago
          </app-button>
        </div>
      </div>

      <!-- Footer -->
      <footer class="storefront-footer">
        <div class="footer-content">
          <div class="footer-section">
            <h5>{{ storeName }}</h5>
            <p>{{ storeDescription }}</p>
          </div>
          <div class="footer-section">
            <h5>Contacto</h5>
            <p>{{ contactInfo }}</p>
          </div>
          <div class="footer-section">
            <h5>Horario</h5>
            <p>{{ storeHours }}</p>
          </div>
        </div>
      </footer>
    </div>
  `,
  styleUrls: ['./storefront.component.scss']
})
export class StorefrontComponent implements OnInit {
  storeName = 'Tienda';
  storeDescription = '';
  branding: any = {};
  heroTitle = 'Bienvenido a Nuestra Tienda';
  heroDescription = 'Descubre los mejores productos con precios increíbles';
  contactInfo = 'Tel: +1 234 567 8900 | Email: info@tienda.com';
  storeHours = 'Lunes a Viernes: 9:00 AM - 6:00 PM';
  
  searchTerm = '';
  selectedCategory: string | null = null;
  sortBy = 'name';
  showCart = false;
  
  categories: any[] = [];
  products: any[] = [];
  filteredProducts: any[] = [];
  cartItems: any[] = [];
  wishlist: any[] = [];

  get cartTotal(): number {
    return this.cartItems.reduce((total, item) => total + (item.price * item.quantity), 0);
  }

  private appConfig = inject(AppConfigService);

  async ngOnInit() {
    // Esperar a que la configuración de la aplicación esté lista
    const appConfig = this.appConfig.getCurrentConfig();
    if (!appConfig) {
      console.warn('[STOREFRONT] App config not available, using default values');
      this.loadDefaultData();
      return;
    }

    const domainConfig = appConfig.domainConfig;
    const tenantConfig = appConfig.tenantConfig;
    
    this.storeName = domainConfig.store_slug || 'Tienda';
    this.branding = tenantConfig?.branding || {};
    this.storeDescription = tenantConfig?.store?.description || '';
    
    // Cargar datos de ejemplo
    this.categories = this.generateSampleCategories();
    this.products = this.generateSampleProducts();
    this.filteredProducts = [...this.products];
  }

  private loadDefaultData() {
    this.categories = this.generateSampleCategories();
    this.products = this.generateSampleProducts();
    this.filteredProducts = [...this.products];
  }

  private generateSampleCategories(): any[] {
    return [
      { id: 'electronics', name: 'Electrónicos', icon: '📱' },
      { id: 'clothing', name: 'Ropa', icon: '👕' },
      { id: 'home', name: 'Hogar', icon: '🏠' },
      { id: 'sports', name: 'Deportes', icon: '⚽' },
      { id: 'books', name: 'Libros', icon: '📚' }
    ];
  }

  private generateSampleProducts(): any[] {
    return [
      {
        id: 1,
        name: 'Smartphone Premium',
        description: 'Teléfono inteligente de última generación',
        price: 699.99,
        originalPrice: 799.99,
        image: '/assets/images/product-placeholder.jpg',
        category: 'electronics',
        stock: 10,
        onSale: true
      },
      {
        id: 2,
        name: 'Camiseta Básica',
        description: 'Camiseta de algodón 100%',
        price: 19.99,
        image: '/assets/images/product-placeholder.jpg',
        category: 'clothing',
        stock: 50,
        onSale: false
      },
      {
        id: 3,
        name: 'Libro de Programación',
        description: 'Guía completa de desarrollo web',
        price: 39.99,
        image: '/assets/images/product-placeholder.jpg',
        category: 'books',
        stock: 25,
        onSale: false
      },
      {
        id: 4,
        name: 'Auriculares Inalámbricos',
        description: 'Sonido premium sin cables',
        price: 149.99,
        originalPrice: 199.99,
        image: '/assets/images/product-placeholder.jpg',
        category: 'electronics',
        stock: 15,
        onSale: true
      }
    ];
  }

  onSearch() {
    this.filterProducts();
  }

  filterByCategory(categoryId: string) {
    this.selectedCategory = this.selectedCategory === categoryId ? null : categoryId;
    this.filterProducts();
  }

  filterProducts() {
    let filtered = [...this.products];
    
    // Filtrar por búsqueda
    if (this.searchTerm) {
      filtered = filtered.filter(product =>
        product.name.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        product.description.toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    
    // Filtrar por categoría
    if (this.selectedCategory) {
      filtered = filtered.filter(product => product.category === this.selectedCategory);
    }
    
    this.filteredProducts = filtered;
    this.sortProducts();
  }

  sortProducts() {
    switch (this.sortBy) {
      case 'name':
        this.filteredProducts.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'price-low':
        this.filteredProducts.sort((a, b) => a.price - b.price);
        break;
      case 'price-high':
        this.filteredProducts.sort((a, b) => b.price - a.price);
        break;
      case 'newest':
        // Simular orden por fecha (en producción usaría fecha real)
        this.filteredProducts.sort((a, b) => b.id - a.id);
        break;
    }
  }

  addToCart(product: any) {
    const existingItem = this.cartItems.find(item => item.id === product.id);
    
    if (existingItem) {
      existingItem.quantity++;
    } else {
      this.cartItems.push({
        ...product,
        quantity: 1
      });
    }
    
    // Mostrar notificación (en producción usaría toast service)
    console.log('Producto agregado al carrito:', product.name);
  }

  removeFromCart(item: any) {
    this.cartItems = this.cartItems.filter(cartItem => cartItem.id !== item.id);
  }

  updateQuantity(item: any, change: number) {
    const newQuantity = item.quantity + change;
    
    if (newQuantity <= 0) {
      this.removeFromCart(item);
    } else if (newQuantity <= item.stock) {
      item.quantity = newQuantity;
    }
  }

  toggleWishlist(product: any) {
    const index = this.wishlist.findIndex(item => item.id === product.id);
    
    if (index > -1) {
      this.wishlist.splice(index, 1);
    } else {
      this.wishlist.push(product);
    }
  }

  toggleCart() {
    this.showCart = !this.showCart;
  }

  scrollToProducts() {
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
  }

  navigateToLogin() {
    // Usar login contextual unificado
    window.location.href = '/auth/login';
  }

  proceedToCheckout() {
    // Navegar al checkout
    window.location.href = '/checkout';
  }
}