import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../../../../../../environments/environment';
import { OptionComponentType } from '../../services/option-groups.service';

/** Product row returned by `GET /store/products`, reduced to what the add-on picker needs. */
export interface OptionComponentProduct {
  id: number;
  name: string;
  sku?: string | null;
  /** Already signed by the API on read. */
  image_url?: string | null;
  product_type?: 'physical' | 'service' | 'prepared' | null;
  is_ingredient?: boolean | null;
  base_price?: number | string | null;
  stock_uom?: { code: string } | null;
  /** True when the product has an active recipe (only then it can be a `recipe` component). */
  has_active_recipe?: boolean | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/**
 * Searches insumos, productos and preparaciones of the store (the endpoint
 * returns all three when `is_ingredient` is omitted) for the add-on picker.
 */
@Injectable({ providedIn: 'root' })
export class OptionComponentSearchService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/store/products`;

  search(term: string, limit = 20): Observable<OptionComponentProduct[]> {
    let params = new HttpParams().set('limit', String(limit));
    const trimmed = term.trim();
    if (trimmed) params = params.set('search', trimmed);
    return this.http
      .get<ApiResponse<OptionComponentProduct[]>>(this.url, { params })
      .pipe(map((res) => res.data ?? []));
  }
}

/**
 * `component_type` is deduced from the chosen product: a prepared product is a
 * recipe unless the listing says it has no active recipe (the backend rejects
 * one without it); a payload without the flag keeps the previous behavior. An
 * ingredient flag means insumo, anything else is a plain product.
 */
export function deduceComponentType(product: OptionComponentProduct): OptionComponentType {
  if (product.product_type === 'prepared' && product.has_active_recipe !== false) return 'recipe';
  if (product.is_ingredient) return 'ingredient';
  return 'product';
}
