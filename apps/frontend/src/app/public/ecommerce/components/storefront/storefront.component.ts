import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ConfigFacade } from '../../../../core/store/config';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputsearchComponent } from '../../../../shared/components/inputsearch/inputsearch.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-storefront',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ButtonComponent,
    CardComponent,
    InputsearchComponent,
    IconComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="storefront-container">
      <!-- Header -->
      <header class="storefront-header">
        <div class="header-content">
          <div class="store-logo" (click)="navigateToHome()">
            @if (branding()?.logo) {
              <img
                [src]="branding()?.logo"
                [alt]="storeName + ' Logo'"
                class="logo-image"
              />
            }
            @if (!branding()?.logo) {
              <div class="logo-fallback">
                <app-icon
                  name="shopping-bag"
                  [size]="28"
                  class="text-primary"
                ></app-icon>
                <h1 class="logo-text">{{ storeName }}</h1>
              </div>
            }
          </div>

          <nav class="store-nav">
            <div class="search-bar">
              <app-inputsearch
                placeholder="Buscar productos..."
                [debounceTime]="400"
                size="sm"
                [ngModel]="searchTerm()"
                (ngModelChange)="searchTerm.set($event)"
                (search)="onSearch()"
              ></app-inputsearch>
            </div>
            <div class="nav-actions">
              <!-- Authenticated User Actions -->
              @if (isAuthenticated()) {
                <button
                  class="icon-btn"
                  (click)="navigateToFavorites()"
                  title="Favoritos"
                >
                  <app-icon name="heart" [size]="22"></app-icon>
                  @if (wishlist().length > 0) {
                    <span class="badge">{{ wishlist().length }}</span>
                  }
                </button>
                <button
                  class="icon-btn"
                  (click)="navigateToProfile()"
                  title="Mi Perfil"
                >
                  <app-icon name="user-circle" [size]="22"></app-icon>
                </button>
              } @else {
                <div class="guest-menu">
                  <button
                    class="icon-btn"
                    (click)="navigateToLogin()"
                    title="Iniciar sesión"
                  >
                    <app-icon name="user" [size]="22"></app-icon>
                  </button>
                  <div class="guest-dropdown">
                    <button (click)="navigateToLogin()">Iniciar Sesión</button>
                    <button (click)="navigateToRegister()">Registrarse</button>
                  </div>
                </div>
              }

              <!-- Guest Actions -->

              <!-- Cart is always visible -->
              <button
                class="icon-btn cart-btn"
                (click)="toggleCart()"
                title="Carrito"
              >
                <app-icon name="shopping-cart" [size]="22"></app-icon>
                @if (cartItems().length > 0) {
                  <span class="badge badge-accent">{{ cartItems().length }}</span>
                }
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
            <p>{{ heroDescription() }}</p>
            <app-button
              (click)="scrollToProducts()"
              variant="primary"
              size="lg"
            >
              Ver Productos
            </app-button>
          </div>
        </section>

        <!-- Categories -->
        @if (categories().length) {
          <section class="categories-section">
            <h3>Categorías</h3>
            <div class="categories-grid">
              @for (category of categories(); track category) {
                <div
                  class="category-card"
                  (click)="filterByCategory(category.id)"
                  [class.active]="selectedCategory() === category.id"
                >
                  <div class="category-icon">{{ category.icon }}</div>
                  <span>{{ category.name }}</span>
                </div>
              }
            </div>
          </section>
        }

        <!-- Products Grid -->
        <section class="products-section" id="products">
          <div class="section-header">
            <h3>Productos</h3>
            <div class="sort-options">
              <select [ngModel]="sortBy()" (ngModelChange)="sortBy.set($event); sortProducts()">
                <option value="name">Ordenar por Nombre</option>
                <option value="price-low">Precio: Menor a Mayor</option>
                <option value="price-high">Precio: Mayor a Menor</option>
                <option value="newest">Más Nuevos</option>
              </select>
            </div>
          </div>

          <div class="products-grid">
            @for (product of filteredProducts(); track product) {
              <div class="product-card">
                <app-card class="product-card-content">
                  <div class="product-image">
                    <img
                      [src]="product.image"
                      [alt]="product.name"
                      class="product-img"
                    />
                    @if (product.onSale) {
                      <div class="sale-badge">Oferta</div>
                    }
                  </div>
                  <div class="product-info">
                    <h4 class="product-name">{{ product.name }}</h4>
                    <p class="product-description">{{ product.description }}</p>
                    <div class="product-pricing">
                      <span class="current-price">{{
                        product.price | currency
                      }}</span>
                      @if (product.originalPrice) {
                        <span class="original-price">
                          {{ product.originalPrice | currency }}
                        </span>
                      }
                    </div>
                    <div class="product-actions">
                      <app-button
                        (click)="addToCart(product)"
                        variant="primary"
                        size="sm"
                        [disabled]="product.stock === 0"
                      >
                        {{
                          product.stock > 0 ? 'Agregar al Carrito' : 'Sin Stock'
                        }}
                      </app-button>
                      <button
                        class="wishlist-btn"
                        (click)="toggleWishlist(product)"
                      >
                        ♡
                      </button>
                    </div>
                  </div>
                </app-card>
              </div>
            }
          </div>

          @if (filteredProducts().length === 0) {
            <div class="no-products">
              <p>No se encontraron productos que coincidan con tu búsqueda.</p>
            </div>
          }
        </section>
      </main>

      <!-- Shopping Cart Sidebar -->
      @if (showCart()) {
        <div class="cart-sidebar">
          <div class="cart-header">
            <h4>Tu Carrito</h4>
            <button class="close-cart" (click)="toggleCart()">×</button>
          </div>
          <div class="cart-items">
            @for (item of cartItems(); track item) {
              <div class="cart-item">
                <img
                  [src]="item.image"
                  [alt]="item.name"
                  class="cart-item-image"
                />
                <div class="cart-item-info">
                  <h5>{{ item.name }}</h5>
                  <p>
                    {{ item.price | currency }} ×
                    {{ item.quantity }}
                  </p>
                </div>
                <div class="cart-item-actions">
                  <button (click)="updateQuantity(item, -1)">-</button>
                  <span>{{ item.quantity }}</span>
                  <button (click)="updateQuantity(item, 1)">+</button>
                  <button class="remove-btn" (click)="removeFromCart(item)">
                    ×
                  </button>
                </div>
              </div>
            }
          </div>
          <div class="cart-footer">
            <div class="cart-total">Total: {{ cartTotal() | currency }}</div>
            <app-button
              variant="primary"
              size="lg"
              (click)="proceedToCheckout()"
            >
              Proceder al Pago
            </app-button>
          </div>
        </div>
      }

      <!-- Footer -->
      <footer class="storefront-footer">
        <div class="footer-content">
          <div class="footer-section">
            <h5>{{ storeName }}</h5>
            <p>{{ storeDescription() }}</p>
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
  styleUrls: ['./storefront.component.scss'],
})
export class StorefrontComponent implements OnInit {
  // Constants
  readonly storeName = 'Tienda';
  readonly heroTitle = 'Bienvenido a Nuestra Tienda';
  readonly contactInfo = 'Tel: +1 234 567 8900 | Email: info@tienda.com';
  readonly storeHours = 'Lunes a Viernes: 9:00 AM - 6:00 PM';

  // Signals para estado de UI
  readonly storeDescription = signal('');
  readonly branding = signal<any>({});
  readonly heroDescription = signal('Descubre los mejores productos con precios increíbles');
  readonly searchTerm = signal('');
  readonly selectedCategory = signal<string | null>(null);
  readonly sortBy = signal('name');
  readonly showCart = signal(false);

  // Data arrays
  readonly categories = signal<any[]>([]);
  readonly products = signal<any[]>([]);
  readonly filteredProducts = signal<any[]>([]);
  readonly cartItems = signal<any[]>([]);
  readonly wishlist = signal<any[]>([]);

  // Computed
  readonly cartTotal = computed(() =>
    this.cartItems().reduce(
      (total, item) => total + item.price * item.quantity,
      0,
    )
  );

  private configFacade = inject(ConfigFacade);
  private authFacade = inject(AuthFacade);
  private router = inject(Router);

  // Reference to authFacade signal
  readonly isAuthenticated = this.authFacade.isAuthenticated;

  async ngOnInit() {
    const appConfig = this.configFacade.getCurrentConfig();
    if (!appConfig) {
      this.loadDefaultData();
      return;
    }

    const domainConfig = appConfig.domainConfig;
    // const tenantConfig = appConfig.tenantConfig;

    // this.storeName = domainConfig.store_slug || 'Tienda'; // readonly, no mutable
    // this.branding.set(tenantConfig?.branding || {});
    // this.storeDescription.set(tenantConfig?.store?.description || '');

    // Cargar datos de ejemplo
    this.categories.set(this.generateSampleCategories());
    this.products.set(this.generateSampleProducts());
    this.filteredProducts.set([...this.products()]);
  }

  private loadDefaultData() {
    this.categories.set(this.generateSampleCategories());
    this.products.set(this.generateSampleProducts());
    this.filteredProducts.set([...this.products()]);
  }

  private generateSampleCategories(): any[] {
    return [
      { id: 'electronics', name: 'Electrónicos', icon: '📱' },
      { id: 'clothing', name: 'Ropa', icon: '👕' },
      { id: 'home', name: 'Hogar', icon: '🏠' },
      { id: 'sports', name: 'Deportes', icon: '⚽' },
      { id: 'books', name: 'Libros', icon: '📚' },
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
        onSale: true,
      },
      {
        id: 2,
        name: 'Camiseta Básica',
        description: 'Camiseta de algodón 100%',
        price: 19.99,
        image: '/assets/images/product-placeholder.jpg',
        category: 'clothing',
        stock: 50,
        onSale: false,
      },
      {
        id: 3,
        name: 'Libro de Programación',
        description: 'Guía completa de desarrollo web',
        price: 39.99,
        image: '/assets/images/product-placeholder.jpg',
        category: 'books',
        stock: 25,
        onSale: false,
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
        onSale: true,
      },
    ];
  }

  onSearch() {
    this.filterProducts();
  }

  filterByCategory(categoryId: string) {
    const currentCategory = this.selectedCategory();
    this.selectedCategory.set(
      currentCategory === categoryId ? null : categoryId
    );
    this.filterProducts();
  }

  filterProducts() {
    let filtered = [...this.products()];
    const searchTermVal = this.searchTerm().toLowerCase();

    // Filtrar por búsqueda
    if (searchTermVal) {
      filtered = filtered.filter(
        (product) =>
          product.name.toLowerCase().includes(searchTermVal) ||
          product.description
            .toLowerCase()
            .includes(searchTermVal),
      );
    }

    // Filtrar por categoría
    const selectedCat = this.selectedCategory();
    if (selectedCat) {
      filtered = filtered.filter(
        (product) => product.category === selectedCat,
      );
    }

    this.filteredProducts.set(filtered);
    this.sortProducts();
  }

  sortProducts() {
    const sortByVal = this.sortBy();
    const filtered = [...this.filteredProducts()];

    switch (sortByVal) {
      case 'name':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'price-low':
        filtered.sort((a, b) => a.price - b.price);
        break;
      case 'price-high':
        filtered.sort((a, b) => b.price - a.price);
        break;
      case 'newest':
        // Simular orden por fecha (en producción usaría fecha real)
        filtered.sort((a, b) => b.id - a.id);
        break;
    }

    this.filteredProducts.set(filtered);
  }

  addToCart(product: any) {
    const currentItems = this.cartItems();
    const existingItem = currentItems.find((item) => item.id === product.id);

    if (existingItem) {
      existingItem.quantity++;
      this.cartItems.set([...currentItems]);
    } else {
      this.cartItems.set([...currentItems, {
        ...product,
        quantity: 1,
      }]);
    }
  }

  removeFromCart(item: any) {
    this.cartItems.set(
      this.cartItems().filter(
        (cartItem) => cartItem.id !== item.id,
      )
    );
  }

  updateQuantity(item: any, change: number) {
    const newQuantity = item.quantity + change;

    if (newQuantity <= 0) {
      this.removeFromCart(item);
    } else if (newQuantity <= item.stock) {
      item.quantity = newQuantity;
      this.cartItems.set([...this.cartItems()]);
    }
  }

  toggleWishlist(product: any) {
    const currentWishlist = this.wishlist();
    const index = currentWishlist.findIndex((item) => item.id === product.id);

    if (index > -1) {
      const updated = [...currentWishlist];
      updated.splice(index, 1);
      this.wishlist.set(updated);
    } else {
      this.wishlist.set([...currentWishlist, product]);
    }
  }

  toggleCart() {
    this.showCart.update(v => !v);
  }

  scrollToProducts() {
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
  }

  navigateToHome() {
    this.router.navigate(['/']);
  }

  navigateToFavorites() {
    this.router.navigate(['/favorites']);
  }

  navigateToProfile() {
    this.router.navigate(['/profile']);
  }

  navigateToRegister() {
    this.router.navigate(['/auth/register']);
  }

  navigateToLogin() {
    this.router.navigate(['/auth/login']);
  }

  proceedToCheckout() {
    this.router.navigate(['/checkout']);
  }
}
