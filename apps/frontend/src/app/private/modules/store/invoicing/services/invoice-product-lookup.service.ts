import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ProductsService } from '../../products/services/products.service';
import {
  Product,
  ProductState,
} from '../../products/interfaces/product.interface';

/**
 * BÚSQUEDA DEL INVENTARIO PARA FACTURAR — CONTRA EL SERVIDOR, NO CONTRA UNA
 * COPIA EN MEMORIA.
 *
 * ─── QUÉ SUSTITUYE ──────────────────────────────────────────────────────────
 *
 * El modal cargaba UNA vez `getProducts({ limit: 200 })` y filtraba en el
 * navegador. Con eso, una tienda con 201 productos no puede facturar el 201:
 * escribe su nombre, el filtro no lo encuentra y no hay ningún error que lo
 * explique — el producto simplemente «no existe». Es el mismo fallo silencioso
 * que el catálogo de impuestos escrito a mano, en otra tabla.
 *
 * ─── QUÉ DEVUELVE ───────────────────────────────────────────────────────────
 *
 * Productos Y servicios: `product_type` NO se filtra a propósito. Una factura de
 * servicios profesionales es el caso más común de esta pantalla, y un filtro por
 * `physical` los habría escondido. El tipo viaja en la opción para que la UI lo
 * distinga, no para excluirlo.
 *
 * ─── POR QUÉ NO LANZA NUNCA ─────────────────────────────────────────────────
 *
 * Porque el inventario es una AYUDA para facturar, no un requisito: el backend
 * declara `product_id` opcional y acepta una línea descrita a mano. Un catálogo
 * caído no puede impedir emitir; devuelve lista vacía y la pantalla ofrece el
 * ítem personalizado.
 *
 * El `debounce` NO vive aquí, vive en el componente que teclea — misma división
 * que `StoreUserLookupService`.
 */

export interface InvoiceProductOption {
  id: number;
  name: string;
  sku?: string;
  category?: string;
  imageUrl?: string;
  /**
   * Precio BASE (sin impuesto). Y no `final_price`: éste último ya lleva el
   * impuesto dentro, y mandarlo como precio unitario mientras la línea declara
   * además el impuesto lo cobraría dos veces.
   */
  basePrice: number;
  productType: 'physical' | 'service' | 'prepared';
  isSellable: boolean;
  /**
   * Escala del precio publicado (`products.price_unit_quantity`, QUI-648).
   * D.10: la previsión de línea divide por él IGUAL QUE EL SERVIDOR; viaja
   * como dato del catálogo y NUNCA como campo editable ni en el payload.
   * Ausente ⇒ divisor 1 (fallback idéntico a `priceUnitDivisor`).
   */
  priceUnitQuantity?: number | null;
}

/** Página corta: es un autocompletar, no un listado. */
const DEFAULT_LIMIT = 20;

@Injectable({ providedIn: 'root' })
export class InvoiceProductLookupService {
  private readonly products = inject(ProductsService);

  /**
   * Búsqueda remota contra `GET /store/products?search=&limit=&state=ACTIVE`.
   *
   * `search` sin término devuelve la primera página, que es lo que hace útil
   * abrir el selector sin escribir nada.
   */
  search(term: string, limit = DEFAULT_LIMIT): Observable<InvoiceProductOption[]> {
    const trimmed = (term ?? '').trim();
    return this.products
      .getProducts({
        limit,
        state: ProductState.ACTIVE,
        ...(trimmed ? { search: trimmed } : {}),
      })
      .pipe(
        map((response) => (response?.data ?? []).map(toOption)),
        catchError(() => of([] as InvoiceProductOption[])),
      );
  }
}

function toOption(product: Product): InvoiceProductOption {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku ?? undefined,
    category: product.category?.name ?? product.categories?.[0]?.name,
    imageUrl: product.image_url,
    basePrice: Number(product.base_price) || 0,
    productType: product.product_type ?? 'physical',
    // `is_sellable` es del módulo de restaurante y no viene en toda tienda;
    // ausente ⇒ vendible, que es el default del backend.
    isSellable: product.is_sellable !== false,
    priceUnitQuantity: product.price_unit_quantity ?? null,
  };
}
