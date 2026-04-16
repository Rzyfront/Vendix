import { Component, inject, AfterViewInit, DestroyRef, ElementRef, ViewChild, input, output, signal } from '@angular/core';

import { ProductCardComponent } from '../product-card/product-card.component';
import { EcommerceProduct } from '../../services/catalog.service';
import { CatalogService, CatalogQuery } from '../../services/catalog.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-products-scroll',
  standalone: true,
  imports: [ProductCardComponent],
  templateUrl: './products-scroll.component.html',
  styleUrls: ['./products-scroll.component.scss'],
})
export class ProductsScrollComponent implements AfterViewInit {
  readonly title = input<string>('Productos');
  readonly query = input<CatalogQuery>({ limit: 12, sort_by: 'newest' });
  readonly initial_products = input<EcommerceProduct[]>([]);
  readonly show_header = input<boolean>(true);
  readonly show_see_all = input<boolean>(true);
  readonly class = input<string>('');

  readonly add_to_cart = output<EcommerceProduct>();
  readonly toggle_wishlist = output<EcommerceProduct>();
  readonly quick_view = output<EcommerceProduct>();

  readonly products = signal<EcommerceProduct[]>([]);
  readonly is_loading = signal(false);
  readonly has_more = signal(true);
  current_page = 1;
  total_pages = 1;

  private observer: IntersectionObserver | null = null;
  private destroyRef = inject(DestroyRef);

  private catalog_service = inject(CatalogService);
  private element_ref = inject(ElementRef);

  ngAfterViewInit(): void {
    this.products.set([...this.initial_products()]);
    // Only setup infinite scroll if we don't have initial products
    if (this.initial_products().length === 0) {
      this.setupInfiniteScroll();
    }
    this.destroyRef.onDestroy(() => {
      if (this.observer) {
        this.observer.disconnect();
      }
    });
  }

  loadMore(): void {
    if (this.is_loading() || !this.has_more()) {
      return;
    }

    this.is_loading.set(true);
    const query = { ...this.query(), page: this.current_page };

    this.catalog_service.getProducts(query).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        this.products.set([...this.products(), ...response.data]);
        this.has_more.set(this.current_page < response.meta.total_pages);
        this.total_pages = response.meta.total_pages;
        this.current_page++;
        this.is_loading.set(false);
      },
      error: () => {
        this.is_loading.set(false);
      },
    });
  }

  private setupInfiniteScroll(): void {
    const options = {
      root: null,
      rootMargin: '100px',
      threshold: 0.1,
    };

    this.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.is_loading() && this.has_more()) {
          this.loadMore();
        }
      });
    }, options);

    const sentinel = this.element_ref.nativeElement.querySelector('.scroll-sentinel');
    if (sentinel) {
      this.observer.observe(sentinel);
    }
  }

  onAddToCart(product: EcommerceProduct): void {
    this.add_to_cart.emit(product);
  }

  onToggleWishlist(product: EcommerceProduct): void {
    this.toggle_wishlist.emit(product);
  }

  onQuickView(product: EcommerceProduct): void {
    this.quick_view.emit(product);
  }
}
