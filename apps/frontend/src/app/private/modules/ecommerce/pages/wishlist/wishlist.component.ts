import { Component, OnInit, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import { WishlistService, Wishlist, WishlistItem } from '../../services/wishlist.service';
import { CartService } from '../../services/cart.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../shared/pipes/currency';

@Component({
  selector: 'app-wishlist',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './wishlist.component.html',
  styleUrls: ['./wishlist.component.scss'],
})
export class WishlistComponent implements OnInit {
  wishlist: Wishlist | null = null;
  is_loading = true;
  removing_id: number | null = null;

  private destroy_ref = inject(DestroyRef);

  constructor(
    private wishlist_service: WishlistService,
    private cart_service: CartService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadWishlist();
  }

  loadWishlist(): void {
    this.is_loading = true;
    this.wishlist_service.getWishlist().subscribe({
      next: () => {
        this.is_loading = false;
      },
      error: () => {
        this.is_loading = false;
      },
    });

    this.wishlist_service.wishlist$.pipe(takeUntilDestroyed(this.destroy_ref)).subscribe((wishlist) => {
      this.wishlist = wishlist;
    });
  }

  removeFromWishlist(product_id: number): void {
    this.removing_id = product_id;
    this.wishlist_service.removeItem(product_id).pipe(
      finalize(() => {
        this.removing_id = null;
      })
    ).subscribe();
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
