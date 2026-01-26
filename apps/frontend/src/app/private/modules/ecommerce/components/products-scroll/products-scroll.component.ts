import { Component, Input, Output, EventEmitter, inject, AfterViewInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductCardComponent } from '../product-card/product-card.component';
import { EcommerceProduct } from '../../services/catalog.service';
import { CatalogService, CatalogQuery } from '../../services/catalog.service';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-products-scroll',
  standalone: true,
  imports: [CommonModule, ProductCardComponent],
  templateUrl: './products-scroll.component.html',
  styleUrls: ['./products-scroll.component.scss'],
})
export class ProductsScrollComponent implements AfterViewInit, OnDestroy {
  @Input() title = 'Productos';
  @Input() query: CatalogQuery = { limit: 12, sort_by: 'newest' };
  @Input() initial_products: EcommerceProduct[] = [];
  @Input() show_header = true;
  @Input() show_see_all = true;
  @Input() class = '';

  @Output() add_to_cart = new EventEmitter<EcommerceProduct>();
  @Output() toggle_wishlist = new EventEmitter<EcommerceProduct>();
  @Output() quick_view = new EventEmitter<EcommerceProduct>();

  products: EcommerceProduct[] = [];
  is_loading = false;
  has_more = true;
  current_page = 1;
  total_pages = 1;

  private destroy$ = new Subject<void>();
  private observer: IntersectionObserver | null = null;

  private catalog_service = inject(CatalogService);
  private element_ref = inject(ElementRef);

  ngAfterViewInit(): void {
    this.products = [...this.initial_products];
    // Only setup infinite scroll if we don't have initial products
    if (this.initial_products.length === 0) {
      this.setupInfiniteScroll();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  loadMore(): void {
    if (this.is_loading || !this.has_more) {
      return;
    }

    this.is_loading = true;
    const query = { ...this.query, page: this.current_page };

    this.catalog_service.getProducts(query).pipe(takeUntil(this.destroy$)).subscribe({
      next: response => {
        this.products = [...this.products, ...response.data];
        this.has_more = this.current_page < response.meta.total_pages;
        this.total_pages = response.meta.total_pages;
        this.current_page++;
        this.is_loading = false;
      },
      error: () => {
        this.is_loading = false;
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
        if (entry.isIntersecting && !this.is_loading && this.has_more) {
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
