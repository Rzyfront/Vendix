import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import type { OptionDeltaParts } from '../../../../../shared/utils/option-pricing.util';

export interface PosProductOption {
  id: number;
  name: string;
  /** Decimal string (or number) — display/preview only, the server recalculates. */
  price_delta: string | number | null;
}

export interface PosProductOptionGroup {
  id: number;
  name: string;
  description?: string | null;
  min_select: number;
  max_select: number;
  is_required: boolean;
  scope: 'per_unit' | 'per_line';
  options: PosProductOption[];
}

/** Result of the add-on selector: ids go to the server, the rest is display only. */
export interface PosOptionSelection {
  option_ids: number[];
  labels: string[];
  /** Σ price_delta for quantity 1 (preview only). */
  delta: number;
  /** per_unit/per_line sums: the cart re-derives the unit delta per quantity. */
  delta_parts: OptionDeltaParts;
}

/**
 * Add-ons (adiciones) available for a product in the POS.
 * Endpoint returns an empty list when `product_options.enabled` is off.
 */
@Injectable({ providedIn: 'root' })
export class PosProductOptionsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/product-option-groups`;

  getGroupsForProduct(productId: number): Observable<PosProductOptionGroup[]> {
    return this.http
      .get<{ data?: PosProductOptionGroup[] } | PosProductOptionGroup[]>(
        `${this.apiUrl}/for-product/${productId}`,
      )
      .pipe(
        map((response) => {
          const data = Array.isArray(response) ? response : response?.data;
          return (data ?? []).filter((g) => (g.options?.length ?? 0) > 0);
        }),
        // Never block a sale because add-ons could not be loaded.
        catchError(() => of([] as PosProductOptionGroup[])),
      );
  }
}
