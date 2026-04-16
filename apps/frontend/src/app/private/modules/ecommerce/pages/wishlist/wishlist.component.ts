import { Component, OnInit, inject, DestroyRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import { WishlistService, Wishlist, WishlistItem } from '../../services/wishlist.service';
import { CartService } from '../../services/cart.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-wishlist',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, ButtonComponent],
  templateUrl: './wishlist.component.html',
  styleUrls: ['./wishlist.component.scss'],
})
export class WishlistComponent implements OnInit {
  readonly wishlist = signal<Wishlist | null>(null);
  readonly is_loading = signal(true);
  readonly removing_id = signal<number | null>(null);

  private destroy_ref = inject(DestroyRef);
  private toast_service = inject(ToastService);

  constructor(
    private wishlist_service: WishlistService,
    private cart_service: CartService,
    private router: Router,
  ) { }

  ngOnInit(): void {
    this.loadWishlist();
  }

  loadWishlist(): void {
    this.is_loading.set(true);
    this.wishlist_service.getWishlist().subscribe({
      next: () => {
        this.is_loading.set(false);
      },
      error: () => {
        this.is_loading.set(false);
      },
    });

    this.wishlist_service.wishlist$.pipe(takeUntilDestroyed(this.destroy_ref)).subscribe((wishlist) => {
      this.wishlist.set(wishlist);
    });
  }

  removeFromWishlist(product_id: number): void {
    this.removing_id.set(product_id);
    this.wishlist_service.removeItem(product_id).pipe(
      finalize(() => {
        this.removing_id.set(null);
      })
    ).subscribe({
      next: () => this.toast_service.info('Producto eliminado de favoritos'),
    });
  }

  addToCart(item: WishlistItem): void {
    const result = this.cart_service.addToCart(item.product_id, 1, item.product_variant_id || undefined);
    if (result) {
      result.subscribe();
    }
  }

  goToProduct(slug: string): void {
    this.router.navigate(['/products', slug]);
  }

  continueShopping(): void {
    this.router.navigate(['/catalog']);
  }
}
