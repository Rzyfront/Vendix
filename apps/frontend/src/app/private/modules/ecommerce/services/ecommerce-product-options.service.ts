import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';

/** Opción de un grupo de adiciones (tienda en línea). */
export interface EcommerceProductOption {
  id: number;
  name: string;
  /** Decimal en string; solo para mostrar. El servidor recalcula el precio. */
  price_delta: string;
}

/** Grupo de adiciones aplicable a un producto. */
export interface EcommerceProductOptionGroup {
  id: number;
  name: string;
  min_select: number;
  max_select: number;
  is_required: boolean;
  scope: 'per_unit' | 'per_line';
  options: EcommerceProductOption[];
}

/** Selección confirmada por el cliente para una línea del carrito. */
export interface CartOptionSelection {
  option_ids: number[];
  /** Etiquetas "Grupo: Opción" para pintar el carrito. */
  labels: string[];
  /** Delta de precio por unidad (solo visual). */
  delta_unit: number;
}

@Injectable({ providedIn: 'root' })
export class EcommerceProductOptionsService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);
  private readonly api_url = `${environment.apiUrl}/ecommerce/product-options`;

  private headers(): HttpHeaders {
    const storeId = this.tenant.getCurrentDomainConfig()?.store_id;
    return new HttpHeaders({ 'x-store-id': storeId?.toString() || '' });
  }

  /**
   * Grupos de adiciones del producto. Cualquier error o ajuste apagado
   * devuelve [] para que la UI se vea exactamente igual que sin adiciones.
   */
  getForProduct(productId: number): Observable<EcommerceProductOptionGroup[]> {
    return this.http
      .get<{ data?: EcommerceProductOptionGroup[] } | EcommerceProductOptionGroup[]>(
        `${this.api_url}/${productId}`,
        { headers: this.headers() },
      )
      .pipe(
        map((res) => {
          const list = Array.isArray(res) ? res : (res?.data ?? []);
          return Array.isArray(list)
            ? list.filter((g) => g?.options?.length)
            : [];
        }),
        catchError(() => of([] as EcommerceProductOptionGroup[])),
      );
  }
}
