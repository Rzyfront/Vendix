import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/**
 * Municipio del catálogo Divipola que la DIAN valida.
 *
 * Trae SIEMPRE su departamento. Ese es el punto: el selector no ofrece
 * municipio y departamento por separado, así que una combinación imposible
 * (Medellín / Cundinamarca) no se puede ni expresar en la UI.
 *
 * Espejo de `DianMunicipalityOption` en
 * `apps/backend/src/domains/store/addresses/dian-municipalities.service.ts`.
 */
export interface DianMunicipalityOption {
  /** Código DANE de 5 dígitos → `addresses.municipality_code`. */
  code: string;
  name: string;
  /** Los 2 primeros dígitos de `code`. */
  department_code: string;
  department_name: string;
  postal_code: string;
}

/** Resultado de una página de búsqueda. */
export interface DianMunicipalitySearchResult {
  items: DianMunicipalityOption[];
  /** Municipios que cumplen el filtro, no solo los de esta página. */
  total: number;
  hasMore: boolean;
}

const EMPTY_RESULT: DianMunicipalitySearchResult = {
  items: [],
  total: 0,
  hasMore: false,
};

/** Primera página ociosa: pocas filas, solo para que el desplegable no abra vacío. */
const FIRST_PAGE_LIMIT = 8;
/** Al teclear vale la pena una ventana más ancha. */
const SEARCH_LIMIT = 20;

/** Envelope estándar de `ResponseService.paginated`. */
interface PaginatedEnvelope<T> {
  data: T[];
  meta?: { total?: number; page?: number; limit?: number };
}

/** Envelope estándar de `ResponseService.success`. */
interface SuccessEnvelope<T> {
  data: T;
}

/**
 * Lectura del catálogo DANE (Divipola) expuesto por
 * `GET /store/addresses/dian/municipalities`.
 *
 * El catálogo son 1122 municipios y vive UNA sola vez en el backend
 * (`dian-geography.ts`); aquí no se replica ni se descarga entero: se busca
 * contra el servidor, igual que `ChartAccountLookupService`. El debounce vive
 * en el componente que consume, no aquí.
 *
 * Los municipios son datos estáticos de gobierno, así que cachear por término
 * de búsqueda para toda la vida de la pestaña es seguro y ahorra la mayoría de
 * las peticiones: varios formularios de dirección abiertos en la misma sesión
 * comparten resultados.
 */
@Injectable({ providedIn: 'root' })
export class DianMunicipalityLookupService {
  private readonly http = inject(HttpClient);
  /**
   * Base del endpoint DANE. Por defecto `/store/addresses/dian/municipalities`
   * (gateado por `store:addresses:read`). El super-admin reusa este servicio
   * pero consume el espejo bajo `/superadmin/addresses/dian/municipalities`
   * — el form debe setearlo vía `setBaseUrl` antes de la primera consulta,
   * idealmente en su constructor o `ngOnInit`.
   */
  private baseUrl = `${environment.apiUrl}/store/addresses/dian/municipalities`;

  /** Cambia la base del endpoint DANE (e.g. super-admin reusa este servicio). */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /** Búsquedas ya resueltas, por `término|límite`. */
  private readonly searches = new Map<
    string,
    Observable<DianMunicipalitySearchResult>
  >();
  /** Municipios ya resueltos por código, para hidratar el CVA sin repetir GET. */
  private readonly byCode = new Map<string, DianMunicipalityOption>();

  /**
   * Busca por código DANE, nombre de municipio o nombre de departamento.
   * Sin término devuelve la primera página del catálogo.
   */
  search(term: string): Observable<DianMunicipalitySearchResult> {
    const trimmed = term?.trim() ?? '';
    const limit = trimmed ? SEARCH_LIMIT : FIRST_PAGE_LIMIT;
    const key = `${trimmed.toLowerCase()}|${limit}`;

    const cached = this.searches.get(key);
    if (cached) return cached;

    let params = new HttpParams().set('limit', String(limit));
    if (trimmed) params = params.set('search', trimmed);

    const request$ = this.http
      .get<PaginatedEnvelope<DianMunicipalityOption>>(this.baseUrl, { params })
      .pipe(
        map((res) => {
          const items = Array.isArray(res?.data) ? res.data : [];
          // Alimenta la caché por código para que una hidratación posterior de
          // un municipio ya visto no vuelva a salir a la red.
          for (const item of items) this.byCode.set(item.code, item);
          const total = res?.meta?.total ?? items.length;
          return { items, total, hasMore: total > items.length };
        }),
        catchError(() => of(EMPTY_RESULT)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    this.searches.set(key, request$);
    return request$;
  }

  /**
   * Resuelve un código DANE guardado a su municipio, para que un formulario en
   * modo edición pinte «Medellín (Antioquia)» y no un campo vacío sobre un
   * valor que sí está puesto. Sin esto, un «Guardar» a ciegas lo borraría.
   */
  resolveByCode(
    code: string | null | undefined,
  ): Observable<DianMunicipalityOption | null> {
    const trimmed = code?.trim();
    if (!trimmed) return of(null);

    const cached = this.byCode.get(trimmed);
    if (cached) return of(cached);

    return this.search(trimmed).pipe(
      map((res) => {
        const exact = res.items.find((item) => item.code === trimmed) ?? null;
        if (exact) this.byCode.set(trimmed, exact);
        return exact;
      }),
    );
  }

  /**
   * Traduce los NOMBRES de un geocodificador a un municipio del catálogo.
   *
   * Nominatim devuelve «Medellín»/«Antioquia» y nunca el código DANE, así que
   * tras ubicar una dirección en el mapa hay que traducir. `null` significa «no
   * se pudo resolver, que lo elija el operador» — jamás se sustituye por Bogotá.
   */
  resolveByName(
    city: string | null | undefined,
    department: string | null | undefined,
  ): Observable<DianMunicipalityOption | null> {
    const cityTrimmed = city?.trim();
    const departmentTrimmed = department?.trim();
    if (!cityTrimmed || !departmentTrimmed) return of(null);

    const params = new HttpParams()
      .set('city', cityTrimmed)
      .set('department', departmentTrimmed);

    return this.http
      .get<SuccessEnvelope<DianMunicipalityOption | null>>(
        `${this.baseUrl}/resolve`,
        { params },
      )
      .pipe(
        map((res) => {
          const match = res?.data ?? null;
          if (match?.code) this.byCode.set(match.code, match);
          return match;
        }),
        catchError(() => of(null)),
      );
  }
}
