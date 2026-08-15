import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
}
import { TaxCategory } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class TaxesService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  /**
   * TODAS las categorías de impuesto de la tienda, no la primera página.
   *
   * `limit` es OBLIGATORIO aquí aunque parezca redundante: `TaxCategoryQueryDto`
   * lo inicializa en **10** en el backend, así que una llamada sin él devuelve
   * diez filas y un `meta.total` que este método descarta al quedarse con
   * `response.data`. El resultado era un truncado SILENCIOSO — ni error, ni
   * lista vacía, ni aviso: simplemente los impuestos 11 en adelante no existían.
   *
   * Y no es un catálogo de adorno. Lo consumen el POS, el carrito del POS y las
   * dos pantallas de alta de producto: en una tienda con más de diez impuestos
   * (IVA por tarifa, INC, IBUA, ICUI, ICA por municipio… se llega rápido), el
   * cajero no podía seleccionar los que faltaban y el producto se guardaba con
   * el impuesto equivocado. Eso viaja después al `cac:TaxSubtotal` del XML.
   *
   * 500 es techo, no expectativa: un catálogo de impuestos por tienda se cuenta
   * en decenas. Si alguna vez se acerca, esto pide paginación de verdad — no un
   * número más grande.
   */
  getTaxCategories(storeId?: number): Observable<TaxCategory[]> {
    let params = new HttpParams().set('limit', '500');
    if (storeId) {
      params = params.set('store_id', storeId.toString());
    }
    return this.http
      .get<
        ApiResponse<TaxCategory[]>
      >(`${this.apiUrl}/store/taxes`, { params })
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  getTaxCategoryById(id: number): Observable<TaxCategory> {
    return this.http
      .get<ApiResponse<TaxCategory>>(`${this.apiUrl}/store/taxes/${id}`)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError)
      );
  }

  createTaxCategory(
    taxCategory: Partial<TaxCategory>,
  ): Observable<TaxCategory> {
    return this.http
      .post<ApiResponse<TaxCategory>>(`${this.apiUrl}/store/taxes`, taxCategory)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError)
      );
  }

  updateTaxCategory(
    id: number,
    taxCategory: Partial<TaxCategory>,
  ): Observable<TaxCategory> {
    return this.http
      .patch<ApiResponse<TaxCategory>>(
        `${this.apiUrl}/store/taxes/${id}`,
        taxCategory,
      )
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  deleteTaxCategory(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/store/taxes/${id}`)
      .pipe(catchError(this.handleError));
  }

  private handleError(error: any): Observable<never> {
    console.error('TaxesService Error:', error);
    throw error;
  }
}