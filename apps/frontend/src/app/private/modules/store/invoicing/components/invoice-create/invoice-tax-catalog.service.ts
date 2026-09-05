import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, map, of, tap } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';

import { environment } from '../../../../../../../environments/environment';
import { TaxOption } from '../../../../../../shared/components/tax-selector';

/**
 * CATÁLOGO COMPLETO DE IMPUESTOS DE LA TIENDA, para la superficie fiscal.
 *
 * ─── POR QUÉ NO SE REUSA `TaxesService.getTaxCategories()` ───────────────────
 *
 * Porque devuelve DIEZ filas. `GET /store/taxes` pagina con `limit = 10` por
 * defecto (`TaxCategoryQueryDto.limit`) y `TaxesService` no manda ninguno, así
 * que una tienda con once impuestos personalizados pierde el onceavo sin un solo
 * error: el selector simplemente no lo ofrece, el usuario factura con la tarifa
 * equivocada y la DIAN acepta el documento porque la aritmética cuadra. Ese es
 * exactamente el tipo de fallo silencioso que esta fase existe para cerrar.
 *
 * `TaxesService` vive en el módulo de productos y lo consumen POS, productos y
 * remisiones; cambiarle la firma para arreglar esto es un cambio de otro dueño.
 * Acá se pide el catálogo COMPLETO explícitamente.
 *
 * ─── LA UNIDAD DE LA TARIFA (ojo, es donde se pierde un 19%) ─────────────────
 *
 * `tax_rates.rate` es `Decimal(6,5)` y guarda una FRACCIÓN: el backend escribe
 * `Number(dto.rate) / 100` al crear la categoría, de modo que un IVA del 19% se
 * persiste como `0.19`. El contrato de la factura
 * (`CreateInvoiceTaxDto.tax_rate`) espera lo contrario: PORCENTAJE, con un
 * `@Max(100)` que rechaza cualquier otra cosa. La conversión se hace aquí, una
 * sola vez, y no en cada componente que pinte un impuesto.
 */

/** Fila de `tax_rates` tal como la anida `GET /store/taxes`. */
interface TaxRateRow {
  id: number;
  name?: string | null;
  /** Decimal serializado: llega como string ("0.19000") o como number. */
  rate?: string | number | null;
  is_inclusive?: boolean | null;
}

/** Fila de `tax_categories` con sus tarifas anidadas. */
interface TaxCategoryRow {
  id: number;
  name: string;
  description?: string | null;
  tax_type?: string | null;
  is_inclusive?: boolean | null;
  /** Presente por el `include: { tax_rates: true }` del backend. */
  tax_rates?: TaxRateRow[] | null;
  /** Algunas respuestas legadas exponen la tarifa en la categoría. */
  rate?: string | number | null;
}

interface TaxCategoryListResponse {
  success?: boolean;
  data?: TaxCategoryRow[];
  meta?: { total?: number };
}

/** Techo generoso: ninguna tienda real declara 200 impuestos distintos. */
const CATALOG_PAGE_SIZE = 200;

/**
 * Paso 9 del plan AIU: cómo terminó la carga del catálogo.
 *
 * `ok` es lista real (quizá vacía de verdad); `forbidden` es 403 por el
 * permiso `store:taxes:read` faltante; `error` es cualquier otro fallo. Los
 * tres dejan la lista en `[]` —un catálogo vacío nunca rompe la pantalla—,
 * pero la superficie tiene que decir cuál de los tres ve.
 */
export type TaxCatalogLoadState = 'ok' | 'forbidden' | 'error';

export function taxCatalogLoadMessage(state: TaxCatalogLoadState): string {
  if (state === 'forbidden') {
    return (
      'No se pudo cargar tu catálogo de impuestos: tu usuario no tiene el ' +
      'permiso store:taxes:read. Pídelo a un administrador; sin catálogo, ' +
      'las líneas AIU gravables viajarían sin impuesto y se rechazarían.'
    );
  }
  return (
    'No se pudo cargar tu catálogo de impuestos: el servidor no respondió. ' +
    'Reintenta en un momento; sin catálogo, las líneas AIU gravables ' +
    'viajarían sin impuesto y se rechazarían.'
  );
}

/** Clasificaciones que RETIENEN valor en vez de sumarlo al total. */
const WITHHOLDING_TYPES = new Set(['withholding', 'reteiva', 'reteica']);

@Injectable({ providedIn: 'root' })
export class InvoiceTaxCatalogService {
  private readonly http = inject(HttpClient);
  private readonly url = environment.apiUrl + '/store/taxes';

  /**
   * Una sola petición por sesión: el catálogo cambia cuando el comerciante crea
   * un impuesto, no mientras teclea una factura. `shareReplay` sin `refCount`
   * para que abrir el modal por segunda vez no vuelva a pegarle al servidor.
   */
  private catalog$: Observable<TaxOption[]> | null = null;

  /**
   * Paso 9: estado de la última carga, además de la lista. `tap`/`catchError`
   * corren una sola vez por carga (el `shareReplay` los protege de los
   * re-suscriptores), así que el estado siempre describe lo que pasó en la red.
   */
  private readonly loadState = signal<TaxCatalogLoadState>('ok');
  readonly catalogState = this.loadState.asReadonly();

  load(): Observable<TaxOption[]> {
    if (!this.catalog$) {
      this.catalog$ = this.http
        .get<TaxCategoryListResponse>(this.url, {
          params: { page: 1, limit: CATALOG_PAGE_SIZE },
        })
        .pipe(
          map((response) => this.toOptions(response?.data ?? [])),
          tap(() => this.loadState.set('ok')),
          // Un catálogo que no carga NO puede tumbar el modal: el usuario
          // todavía puede facturar sin impuestos, y la lista sigue siendo
          // `[]` —pero el estado dice POR QUÉ, para que la pantalla no lo
          // presente como «catálogo vacío».
          catchError((error: unknown) => {
            const status =
              error instanceof HttpErrorResponse ? error.status : 0;
            this.loadState.set(status === 403 ? 'forbidden' : 'error');
            return of([] as TaxOption[]);
          }),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.catalog$;
  }

  /** Fuerza una recarga (p. ej. tras crear un impuesto desde otra pantalla). */
  invalidate(): void {
    this.catalog$ = null;
    this.loadState.set('ok');
  }

  /** `true` si la clasificación fiscal retiene en vez de gravar. */
  static isWithholding(taxType: string | null | undefined): boolean {
    return !!taxType && WITHHOLDING_TYPES.has(taxType);
  }

  private toOptions(rows: TaxCategoryRow[]): TaxOption[] {
    const options: TaxOption[] = [];
    for (const row of rows) {
      const rates = row.tax_rates ?? [];
      if (rates.length === 0) {
        // Categoría sin tarifa: se ofrece igual con la tarifa de la categoría
        // (camino legado) o al 0%. Ocultarla haría desaparecer un impuesto que
        // el comerciante SÍ configuró.
        //
        // ⚠️ `id` NEGATIVO, y no `row.id`. El `id` de una opción viaja como
        // `tax_rate_id`, y esa columna tiene FK a `tax_rates(id)`: mandar acá
        // el id de la CATEGORÍA apunta a una fila de otra tabla que puede o no
        // existir en `tax_rates`. Cuando no existe, Postgres rechaza el INSERT
        // DESPUÉS de que el generador ya avanzó el consecutivo autorizado; y
        // cuando por coincidencia existe, es peor: la factura queda apuntando
        // a una tarifa ajena sin que nada lo señale. El negativo lo descarta
        // `buildTaxPayload` antes de armar el payload, y la línea viaja con
        // `tax_name` + `tax_rate`, que es todo lo que el backend necesita para
        // recalcular.
        options.push({
          id: -row.id,
          name: row.name,
          rate: toPercent(row.rate),
          tax_type: row.tax_type ?? undefined,
          default_is_inclusive: row.is_inclusive ?? false,
        });
        continue;
      }
      for (const rate of rates) {
        options.push({
          // El id que viaja en `tax_rate_id` es el de la TARIFA, no el de la
          // categoría: es la fila que fija el porcentaje.
          id: rate.id,
          name: buildName(row.name, rate.name),
          rate: toPercent(rate.rate ?? row.rate),
          tax_type: row.tax_type ?? undefined,
          default_is_inclusive: rate.is_inclusive ?? row.is_inclusive ?? false,
        });
      }
    }
    return options;
  }
}

/**
 * Fracción → porcentaje.
 *
 * El guardarraíl del `> 1` no es paranoia gratuita: existen filas sembradas por
 * caminos que ya escribían porcentaje. Como el `create` del backend siempre
 * divide entre 100, cualquier valor `<= 1` es fracción y cualquier valor mayor
 * ya venía en porcentaje. El único punto ambiguo sería una tarifa del 1%
 * guardada como `1`, que no existe: se guardaría como `0.01`.
 */
function toPercent(raw: string | number | null | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  const percent = value > 1 ? value : value * 100;
  // Dos decimales: `Decimal(6,5)` da como mucho 0.00001 → 0.001%, y arrastrar
  // el artefacto de coma flotante (0.19 * 100 = 19.000000000000004) haría que
  // el `@Max(100)` del backend viera un número que el usuario nunca escribió.
  return Math.round(percent * 100) / 100;
}

/** "IVA" + "IVA 19%" no se concatenan; nombres distintos sí. */
function buildName(
  categoryName: string,
  rateName: string | null | undefined,
): string {
  const rate = (rateName ?? '').trim();
  if (!rate || rate === categoryName) return categoryName;
  return categoryName + ' · ' + rate;
}
