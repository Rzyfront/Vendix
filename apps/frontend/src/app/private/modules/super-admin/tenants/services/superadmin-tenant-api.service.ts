import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import type {
  TenantApiResponse,
  TenantDirectoryQuery,
  TenantDirectoryRow,
  TenantPaginatedResponse,
  TenantProfile,
  TenantScopeSegment,
} from '../interfaces/tenant-profile.interface';

/**
 * Cliente HTTP de la consola de tenants (`/superadmin/tenants/*`).
 *
 * NO lleva `providedIn: 'root'`: se provee en la rama de ruta del perfil
 * (`tenant-profile.routes.ts`), de modo que ningún otro rincón del panel pueda
 * inyectarlo por accidente y acabar consultando tenants ajenos desde una
 * pantalla que no los muestra.
 */
@Injectable()
export class SuperadminTenantApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/superadmin/tenants`;

  /**
   * Directorio cross-tenant. `scope_drift` viene relleno cuando una
   * organización de NIT único arrastra configuraciones DIAN ancladas a tienda.
   */
  list(
    query: TenantDirectoryQuery = {},
  ): Observable<TenantPaginatedResponse<TenantDirectoryRow>> {
    let params = new HttpParams();
    if (query.search) params = params.set('search', query.search);
    if (query.enablement_status) {
      params = params.set('enablement_status', query.enablement_status);
    }
    if (typeof query.is_active === 'boolean') {
      params = params.set('is_active', String(query.is_active));
    }
    if (query.page) params = params.set('page', String(query.page));
    if (query.limit) params = params.set('limit', String(query.limit));

    return this.http.get<TenantPaginatedResponse<TenantDirectoryRow>>(
      this.base,
      { params },
    );
  }

  /**
   * Perfil de configuración del tenant.
   *
   * `scope` va en PLURAL (`stores` / `organizations`). Construir la URL con el
   * literal `/store/` haría que `DomainScopeGuard` respondiese 403 con un token
   * `VENDIX_ADMIN`, así que el tipo `TenantScopeSegment` es la defensa.
   */
  getProfile(
    scope: TenantScopeSegment,
    tenantId: number,
  ): Observable<TenantApiResponse<TenantProfile>> {
    return this.http.get<TenantApiResponse<TenantProfile>>(
      `${this.base}/${scope}/${tenantId}/profile`,
    );
  }
}
