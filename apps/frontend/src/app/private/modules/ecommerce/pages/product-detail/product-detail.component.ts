import { Component, OnInit, inject, DestroyRef, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CatalogService, ProductDetail, Product, CatalogQuery } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { ProductCarouselComponent } from '../../components/product-carousel';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';

@Component({
    selector: 'app-product-detail',
    standalone: true,
    imports: [CommonModule, RouterModule],
    template: `
    <div class="product-detail-page">
      <p>Página de detalle del producto - En desarrollo</p>
      <a routerLink="/catalog">← Volver al catálogo</a>
    </div>
  `,
    styles: [`
    .product-detail-page {
      padding: 2rem;
      text-align: center;
      
      a {
        color: var(--color-primary);
        text-decoration: none;
        &:hover { text-decoration: underline; }
      }
    }
  `],
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private catalogService = inject(CatalogService);
  private cartService = inject(CartService);
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);

  // States
  product = signal<ProductDetail | null>(null);
  isLoading = signal(true);
  hasError = signal(false);
  activeImageUrl = signal<string | null>(null);
  selectedVariantId = signal<number | null>(null);
  isDescriptionExpanded = signal(false);
  quantity = signal(1);

  // Quick View Modal
  quickViewOpen = false;
  selectedProductSlug: string | null = null;

  // Recommendations
  recommendedProducts = signal<Product[]>([]);

  // Review Form
  reviewForm = this.fb.group({
    rating: [5, [Validators.required, Validators.min(1), Validators.max(5)]],
    comment: ['', [Validators.required, Validators.minLength(10)]],
  });

  // Computed
  latestReviews = computed(() => {
    const p = this.product();
    if (!p || !p.reviews) return [];
    return [...p.reviews]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3);
  });

  ngOnInit(): void {
    this.route.params.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params: any) => {
      const slug = params['slug'];
      if (slug) this.loadProduct(slug);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  loadProduct(slug: string): void {
    this.isLoading.set(true);
    this.hasError.set(false);
    this.catalogService.getProductBySlug(slug).subscribe({
      next: (response: any) => {
        if (response.success) {
          const product = response.data;
          this.product.set(product);
          this.activeImageUrl.set(product.image_url);
          if (product.variants?.length) this.selectedVariantId.set(product.variants[0].id);
          this.loadRecommendations(product);
        } else {
          this.hasError.set(true);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.hasError.set(true);
        this.isLoading.set(false);
      }
    });
  }

  loadRecommendations(product: ProductDetail): void {
    const query: CatalogQuery = { limit: 10, sort_by: 'newest' };
    if (product.categories?.length) query.category_id = product.categories[0].id;
    this.catalogService.getProducts(query).subscribe({
      next: (response: any) => {
        this.recommendedProducts.set(response.data.filter((p: any) => p.id !== product.id));
      }
    });
  }

  setActiveImage(url: string): void { this.activeImageUrl.set(url); }
  selectVariant(variant: any): void { this.selectedVariantId.set(variant.id); }
  toggleDescription(): void { this.isDescriptionExpanded.update((v: boolean) => !v); }
  onAddToCart(product: Product | ProductDetail): void { const result = this.cartService.addToCart(product.id, this.quantity()); if (result) { result.subscribe(); } }
  onQuickView(product: Product): void { this.selectedProductSlug = product.slug; this.quickViewOpen = true; }

  onSubmitReview(): void {
    if (this.reviewForm.invalid) return;
    const currentProduct = this.product();
    if (currentProduct) {
      const newReview = {
        id: Math.floor(Math.random() * 10000),
        rating: this.reviewForm.get('rating')?.value ?? 5,
        comment: this.reviewForm.get('comment')?.value ?? '',
        created_at: new Date().toISOString(),
        user_name: 'Comprador'
      };
      this.product.set({
        ...currentProduct,
        reviews: [newReview, ...(currentProduct.reviews || [])],
        review_count: (currentProduct.review_count || 0) + 1
      });
    }
    this.reviewForm.reset({ rating: 5, comment: '' });
  }
}
