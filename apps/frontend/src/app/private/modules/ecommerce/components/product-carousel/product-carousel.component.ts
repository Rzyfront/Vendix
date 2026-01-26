import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Product } from '../../services/catalog.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-product-carousel',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="carousel-container">
      <div class="carousel-header">
        <h3 class="carousel-title">{{ title }}</h3>
        <div class="carousel-controls">
          <button class="control-btn" (click)="scrollLeft()" aria-label="Anterior">
            <app-icon name="chevron-left" [size]="20" />
          </button>
          <button class="control-btn" (click)="scrollRight()" aria-label="Siguiente">
            <app-icon name="chevron-right" [size]="20" />
          </button>
        </div>
      </div>

      <div class="carousel-viewport" #viewport (scroll)="onScroll()">
        <div class="carousel-track">
          @for (product of products; track product.id) {
            <div class="carousel-item" (click)="onQuickView(product)">
              <div class="product-mini-card">
                <div class="image-wrapper">
                  <img [src]="product.image_url" [alt]="product.name" loading="lazy" />
                  @if (product.is_on_sale) {
                    <span class="sale-badge">Oferta</span>
                  }
                  <button class="add-cart-btn" (click)="onAddToCart($event, product)" title="Agregar a la orden">
                    <app-icon name="plus" [size]="16" />
                  </button>
                </div>
                <div class="product-info">
                  <span class="product-brand" *ngIf="product.brand">{{ product.brand.name }}</span>
                  <h4 class="product-name">{{ product.name }}</h4>
                  <div class="product-price">
                    <span class="current-price">{{ product.final_price | currency }}</span>
                    @if (product.is_on_sale) {
                      <span class="original-price text-xs line-through opacity-50 ml-2" style="text-decoration: line-through;">
                        {{ product.base_price | currency }}
                      </span>
                    }
                  </div>
                </div>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .carousel-container {
      width: 100%;
      margin: 2rem 0;
    }

    .carousel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding: 0 0.5rem;
    }

    .carousel-title {
      font-size: var(--fs-xl);
      font-weight: var(--fw-bold);
      color: var(--color-text-primary);
      margin: 0;
    }

    .carousel-controls {
      display: flex;
      gap: 0.5rem;
    }

    .control-btn {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all var(--transition-fast);

      &:hover {
        background: var(--color-primary);
        color: white;
        border-color: var(--color-primary);
      }
    }

    .carousel-viewport {
      width: 100%;
      overflow-x: auto;
      scroll-behavior: smooth;
      scroll-snap-type: x mandatory;
      scrollbar-width: none; /* Firefox */
      &::-webkit-scrollbar { display: none; } /* Chrome/Safari */
    }

    .carousel-track {
      display: flex;
      gap: 1rem;
      padding: 0.5rem;
    }

    .carousel-item {
      flex: 0 0 calc(16.666% - 0.8rem); /* Show 6 items */
      scroll-snap-align: start;
      min-width: 140px;

      @media (max-width: 1200px) { flex: 0 0 calc(20% - 0.8rem); } /* 5 items */
      @media (max-width: 992px) { flex: 0 0 calc(25% - 0.8rem); } /* 4 items */
      @media (max-width: 768px) { flex: 0 0 calc(33.33% - 0.7rem); } /* 3 items */
      @media (max-width: 576px) { flex: 0 0 calc(50% - 0.5rem); } /* 2 items */
    }

    .product-mini-card {
      background: var(--color-surface);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      padding: 0.75rem;
      height: 100%;
      cursor: pointer;
      transition: transform var(--transition-fast), border-color var(--transition-fast);

      &:hover {
        transform: translateY(-2px);
        border-color: var(--color-primary);
        box-shadow: var(--shadow-sm);
      }
    }

    .image-wrapper {
      position: relative;
      aspect-ratio: 1;
      border-radius: var(--radius-sm);
      overflow: hidden;
      margin-bottom: 0.75rem;
      background: var(--color-background);

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .sale-badge {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        background: var(--color-error);
        color: white;
        padding: 0.125rem 0.5rem;
        border-radius: var(--radius-pill);
        font-size: 0.65rem;
        font-weight: var(--fw-bold);
      }
      
      .add-cart-btn {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0;
        transform: translateY(10px);
        transition: all var(--transition-fast);
        box-shadow: var(--shadow-sm);
        color: var(--color-text-primary);
        
        &:hover {
          background: var(--color-primary);
          color: white;
          border-color: var(--color-primary);
        }
      }
      
      .product-mini-card:hover & .add-cart-btn {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .product-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .product-brand {
      font-size: 0.65rem;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .product-name {
      font-size: var(--fs-sm);
      font-weight: var(--fw-medium);
      color: var(--color-text-primary);
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .product-price {
      .current-price, .sale-price {
        font-size: var(--fs-base);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
      }
      .sale-price { color: var(--color-error); }
    }
  `],
})
export class ProductCarouselComponent implements AfterViewInit, OnDestroy {
  @Input() title = 'Productos sugeridos';
  @Input() products: Product[] = [];
  @Output() quick_view = new EventEmitter<Product>();
  @Output() add_to_cart = new EventEmitter<Product>();

  @ViewChild('viewport') viewport!: ElementRef<HTMLDivElement>;

  private autoScrollInterval: any;

  ngAfterViewInit(): void {
    this.startAutoScroll();
  }

  ngOnDestroy(): void {
    this.stopAutoScroll();
  }

  scrollLeft(): void {
    this.stopAutoScroll();
    const el = this.viewport.nativeElement;
    el.scrollLeft -= el.offsetWidth / 2;
  }

  scrollRight(): void {
    this.stopAutoScroll();
    const el = this.viewport.nativeElement;
    el.scrollLeft += el.offsetWidth / 2;
  }

  onScroll(): void {
    // can reset timer here if manual interaction
  }

  onQuickView(product: Product): void {
    this.quick_view.emit(product);
  }

  onAddToCart(event: Event, product: Product): void {
    event.stopPropagation();
    event.preventDefault();
    this.add_to_cart.emit(product);
  }

  private startAutoScroll(): void {
    this.autoScrollInterval = setInterval(() => {
      const el = this.viewport.nativeElement;
      if (el.scrollLeft >= el.scrollWidth - el.offsetWidth) {
        el.scrollLeft = 0;
      } else {
        el.scrollLeft += 1; // Slow movement
      }
    }, 50);
  }

  private stopAutoScroll(): void {
    if (this.autoScrollInterval) {
      clearInterval(this.autoScrollInterval);
    }
  }
}
